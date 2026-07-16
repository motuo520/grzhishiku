# LLM 计费系统接入说明

本文档说明「个人第二大脑」商业化 Phase 1 的 LLM 计费体系：余额账户、模型目录、调用扣费、充值到账与 Admin 管理。

## 1. 核心设计

- **先冻结，后结算**：每次 LLM 调用前按预估 token 冻结余额；调用完成后按实际 token 多退少补。
- **模型目录驱动**：可计费模型统一维护在 `llm_models` 表，Admin 可增删改查，前端模型选择器从 `/api/v1/llm/models/catalog` 读取。
- **试用余额**：新用户注册自动发放 1 元（CNY）试用余额（需系统配置 `enable_signup_bonus=true`）；旧用户在第一次调用时也会自动补发。
- **充值流程**：用户创建 topup 订单 → 支付渠道 webhook 通知 → 系统自动充值余额。

## 2. 数据模型

| 表 | 说明 |
| --- | --- |
| `llm_models` | 系统可计费模型目录（id / provider / 价格 / 上下文长度等） |
| `model_provider_accounts` | 平台上游厂商账户（API key / base_url / 余额） |
| `user_balances` | 用户余额账户（可用余额 / 冻结金额 / 总充值 / 总使用） |
| `balance_transactions` | 余额流水（充值 / 使用 / 退款 / 解冻等） |
| `llm_usage_records` | 每次 LLM 调用的预估与实际用量、费用、状态 |

## 3. 关键接口

### 3.1 余额

```http
GET /api/v1/billing/balance
Authorization: Bearer <token>
```

响应：

```json
{
  "balance": 5.0000,
  "frozen": 0.0000,
  "total_deposited": 5.0000,
  "total_used": 0.0000,
  "currency": "CNY"
}
```

### 3.2 使用记录

```http
GET /api/v1/billing/usage?limit=20&offset=0
Authorization: Bearer <token>
```

### 3.3 充值

```http
POST /api/v1/billing/topup
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 1000,
  "payment_method": "alipay"
}
```

`amount` 单位为分（1000 = 10 元）。响应返回订单号 `order_id`。

### 3.4 Webhook（模拟）

```http
POST /api/v1/billing/webhook/alipay
Content-Type: application/json

{
  "out_trade_no": "<order_id>",
  "trade_no": "ALI123456",
  "trade_status": "TRADE_SUCCESS",
  "total_amount": "10.00"
}
```

### 3.5 模型目录

```http
GET /api/v1/llm/models/catalog
Authorization: Bearer <token>
```

## 4. 调用计费流程

1. 用户选择模型并发起调用（聊天 / Pipeline 提取 / Pipeline 碰撞）。
2. 后端根据模型价格估算输入/输出 token 费用，调用 `LLMBillingService.freeze()` 冻结余额。
3. 余额不足返回 `402 Payment Required`。
4. 调用上游 LLM，流式或非流式返回结果。
5. 调用结束后，根据实际 token 用量调用 `LLMBillingService.complete()` 结算：解冻 → 按实际费用扣款 → 返还差额。
6. 若调用失败，调用 `LLMBillingService.fail()` 全额解冻。

## 5. Admin 管理

管理员可通过 `/api/admin/llm/models` 与 `/api/admin/llm/provider-accounts` 管理模型与厂商账户。

前端入口：设置 → Admin → 模型管理。

## 6. 价格配置

价格以 **CNY / 1K tokens** 为单位：

- `cost_input_per_1k` / `cost_output_per_1k`：平台成本价
- `price_input_per_1k` / `price_output_per_1k`：用户售价

目前 Phase 1 聊天与 Pipeline 统一按 `price_*` 向用户计费，按 `cost_*` 记录平台成本。

## 7. 测试

```bash
cd backend
.venv/Scripts/python.exe -m pytest tests/test_llm_billing.py -v
```

覆盖场景：

- 注册赠送试用余额
- 余额接口鉴权
- 充值订单创建与 webhook 到账
- 冻结/结算余额计算

## 9. 优惠券系统（Phase 2）

优惠券支持固定金额抵扣与百分比折扣，可用于订阅和 LLM 余额充值。

### 9.1 模型

| 字段 | 说明 |
| --- | --- |
| `coupons` | 优惠码主表（code / type / value / 有效期 / 适用范围 / 使用次数上限） |
| `coupon_usages` | 用户使用记录（user_id / coupon_id / payment_id） |

- `type = fixed`：`value` 为抵扣金额（分）。
- `type = percent`：`value` 为折扣百分比（1-100），可通过 `max_discount` 设置上限（分）。
- `applies_to`：`subscription` / `topup` / `all`。
- 每个用户每个优惠码只能使用一次。

### 9.2 用户端接口

校验优惠码：

```http
POST /api/v1/billing/validate-coupon
Authorization: Bearer <token>
Content-Type: application/json

{
  "code": "SUMMER2026",
  "payment_type": "subscription",
  "original_amount": 2000,
  "plan_id": "<plan_id>"
}
```

订阅或充值时携带 `coupon_code`：

```http
POST /api/v1/billing/subscribe
Authorization: Bearer <token>
Content-Type: application/json

{
  "plan_id": "<plan_id>",
  "billing_cycle": "monthly",
  "payment_method": "alipay",
  "coupon_code": "SUMMER2026"
}
```

```http
POST /api/v1/billing/topup
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 1000,
  "payment_method": "alipay",
  "coupon_code": "SUMMER2026"
}
```

支付成功后，系统会自动：

1. 记录 `CouponUsage`。
2. 将 `coupon_id` 写入对应的 `Payment` 与 `Subscription`。
3. 充值订单按 **实际支付金额**（折扣后）到账余额。

### 9.3 Admin 管理

管理员通过 `/api/admin/billing/coupons` 创建、启用/停用、查看使用记录：

```http
POST /api/admin/billing/coupons
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "code": "SUMMER2026",
  "type": "percent",
  "value": 20,
  "max_discount": 300,
  "applies_to": "subscription",
  "min_amount": 1000,
  "max_uses": 100
}
```

前端入口：Admin → 订阅计费 → 优惠券 Tab。

## 10. 测试

```bash
cd backend
.venv/Scripts/python.exe -m pytest tests/test_llm_billing.py tests/test_coupons.py -v
```

覆盖场景：

- 注册赠送试用余额
- 余额接口鉴权
- 充值订单创建与 webhook 到账
- 冻结/结算余额计算
- 固定金额与百分比优惠券折扣
- 优惠券过期 / 使用次数耗尽 / 适用范围不匹配
- 充值订单使用优惠券后 webhook 到账金额正确

## 11. 后续可扩展

- 多币种（USD）结算
- 并发扣费压力测试与分布式锁
- 上游厂商账户余额监控与自动切换
- 优惠券与推荐返佣联动
