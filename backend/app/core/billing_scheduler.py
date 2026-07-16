"""Billing scheduler: daily expiry marking and auto-renewal attempts."""
import logging
from datetime import datetime, timedelta
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.billing import Subscription, Payment
from app.services.billing_service import BillingService
from app.services.payment_service import PaymentService
from app.services.payment_providers.factory import get_payment_factory
from app.services.payment_providers.base import PaymentProviderType

logger = logging.getLogger(__name__)

_scheduler: Optional[AsyncIOScheduler] = None


async def expire_subscriptions_job(db: Optional[Session] = None) -> int:
    """Cron job: mark past-due subscriptions as expired."""
    db = db or SessionLocal()
    owns_session = not db.in_transaction()
    try:
        billing = BillingService(db)
        count = billing.expire_subscriptions()
        logger.info("Billing scheduler expired %s subscription(s)", count)
        return count
    except Exception as e:
        logger.exception("expire_subscriptions_job failed: %s", e)
        raise
    finally:
        if owns_session:
            db.close()


async def auto_renew_job(db: Optional[Session] = None) -> dict:
    """Cron job: attempt to renew subscriptions nearing expiration.

    In mock/dev mode the provider returns success immediately, so renewals
    complete end-to-end. In production, providers that support automatic
    charging (e.g. Stripe subscriptions) will succeed; otherwise a pending
    payment order is created and the subscription will be expired by the
    expiry job if the user does not complete payment.
    """
    db = db or SessionLocal()
    owns_session = not db.in_transaction()
    try:
        billing = BillingService(db)
        factory = get_payment_factory()
        payment_service = PaymentService(db, factory)

        now = datetime.utcnow()
        renew_window = now + timedelta(days=1)

        subs = (
            db.query(Subscription)
            .filter(
                Subscription.status == "active",
                Subscription.auto_renew == True,
                Subscription.current_period_end <= renew_window,
                Subscription.current_period_end > now,
            )
            .all()
        )

        processed = 0
        renewed = 0
        failed = 0

        for sub in subs:
            processed += 1
            plan = billing.get_plan(sub.plan_id)
            if not plan:
                logger.warning("Auto-renew skipped: plan %s not found for sub %s", sub.plan_id, sub.id)
                failed += 1
                continue

            amount = plan.price_yearly if sub.billing_cycle == "yearly" else plan.price_monthly
            if amount <= 0:
                # Free plan with active subscription should not happen, but extend just in case
                sub.current_period_end = billing._extend_period(sub.current_period_end, sub.billing_cycle)
                renewed += 1
                continue

            try:
                provider_type = PaymentProviderType(sub.payment_method or "alipay")
                provider = factory.get_provider(provider_type)

                # Dev/mock mode: provider has no real credentials, so simulate a successful charge
                if provider._get_client() is None:
                    sub.current_period_end = billing._extend_period(
                        sub.current_period_end, sub.billing_cycle
                    )
                    payment = Payment(
                        id=f"AR{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{sub.id[-8:].upper()}",
                        user_id=sub.user_id,
                        plan_id=sub.plan_id,
                        amount=amount,
                        original_amount=amount,
                        currency=plan.currency,
                        status="success",
                        description=f"自动续费 {plan.name} - {sub.billing_cycle}",
                        payment_method=provider_type.value,
                        payment_provider=provider_type.value,
                        payment_type="subscription",
                    )
                    db.add(payment)
                    renewed += 1
                    logger.info("Auto-renewed subscription %s for user %s (mock)", sub.id, sub.user_id)
                    continue

                order = await payment_service.create_payment_order(
                    user_id=sub.user_id,
                    plan_id=sub.plan_id,
                    provider=provider_type.value,
                    billing_cycle=sub.billing_cycle,
                )
                if order.status.value == "success":
                    # Fully automatic provider (e.g. Stripe subscriptions): extend the subscription
                    sub.current_period_end = billing._extend_period(
                        sub.current_period_end, sub.billing_cycle
                    )
                    renewed += 1
                    logger.info("Auto-renewed subscription %s for user %s", sub.id, sub.user_id)
                else:
                    # Payment order is pending; user/provider must complete it
                    logger.info(
                        "Auto-renew order %s pending for subscription %s (provider=%s)",
                        order.order_id, sub.id, order.provider.value,
                    )
            except Exception as e:
                failed += 1
                logger.exception("Auto-renew failed for subscription %s: %s", sub.id, e)

        db.flush()
        if owns_session:
            db.commit()
        result = {"processed": processed, "renewed": renewed, "failed": failed}
        logger.info("Auto-renew job finished: %s", result)
        return result
    except Exception as e:
        logger.exception("auto_renew_job failed: %s", e)
        raise
    finally:
        if owns_session:
            db.close()


async def initialize_billing_scheduler() -> None:
    """Start the billing scheduler and register cron jobs."""
    global _scheduler
    if _scheduler is not None:
        return

    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        expire_subscriptions_job,
        CronTrigger(hour=2, minute=0),
        id="expire_subscriptions",
        replace_existing=True,
    )
    _scheduler.add_job(
        auto_renew_job,
        CronTrigger(hour=3, minute=0),
        id="auto_renew",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("Billing scheduler started with expiry and auto-renew jobs")


async def shutdown_billing_scheduler() -> None:
    """Gracefully shutdown the billing scheduler."""
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("Billing scheduler stopped")
