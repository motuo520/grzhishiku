r"""Seed LLM models from supplier doc and generate config snippets.

Usage:
    cd backend
    .venv/Scripts/python scripts/seed_supplier_models.py

This script:
1. Parses C:\Users\motuo\Desktop\模型接口和价格供应商.md
2. Deletes existing non-Ollama models from llm_models table
3. Inserts new models with USD pricing
4. Creates/updates provider accounts for opencode, deepseek, kimi (empty API keys)
5. Writes generated config snippets to:
       scripts/generated_model_config.py  (for llm_service.py)
       scripts/generated_frontend_models.ts  (for llmModels.ts)
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.database import SessionLocal
from app.models.llm_billing import LLMModel, ModelProviderAccount


SUPPLIER_DOC = r"C:\Users\motuo\Desktop\模型接口和价格供应商.md"

# Pricing constants
EXCHANGE_RATE_USD_TO_CNY = 7.30  # USD -> RMB exchange rate for OpenCode / Kimi
DEEPSEEK_MARKUP = 1.30           # DeepSeek official price multiplier
# DeepSeek official prices (CNY per 1M tokens, cache-miss input / output)
DEEPSEEK_OFFICIAL_PRICES = {
    "deepseek-v4-pro":   {"input": 3.0, "output": 6.0},
    "deepseek-v4-flash": {"input": 1.0, "output": 2.0},
}


def parse_doc():
    with open(SUPPLIER_DOC, "r", encoding="utf-8") as f:
        text = f.read()

    # Parse OpenCode endpoint table
    endpoint_rows = re.findall(
        r"^([A-Za-z0-9\.\s\-]+?)\t([a-z0-9\.\-]+)\t(https://opencode\.ai/[^\t]+)\t(@[^\t\n]+)$",
        text,
        re.MULTILINE,
    )

    models = []
    for name, mid, endpoint, sdk in endpoint_rows:
        name = name.strip()
        # DeepSeek is handled separately as a direct provider; skip OpenCode wrappers
        # so they don't appear as free zero-priced duplicates.
        if "deepseek" in mid:
            continue
        if "/responses" in endpoint:
            api_type = "responses"
        elif "/messages" in endpoint:
            api_type = "messages"
        elif "/models/" in endpoint:
            api_type = "models"
        else:
            api_type = "chat"
        frontend_id = "opencode-" + mid.replace(".", "-")
        models.append({
            "name": name,
            "id": frontend_id,
            "provider_model_id": "opencode/" + mid,
            "provider": "opencode",
            "api_type": api_type,
            "price_input": 0.0,
            "price_output": 0.0,
            "currency": "CNY",
        })

    # Parse price table
    price_rows = re.findall(
        r"^([A-Za-z0-9\.\s\-≤\(\)\>]+?)\t\$([0-9\.]+)\t\$([0-9\.]+)(?:\t\$([0-9\.\-]+)\t([^\t\n]+))?$",
        text,
        re.MULTILINE,
    )

    price_map = {}
    for name, inp, out, cheap, extra in price_rows:
        name = name.strip()
        base = re.sub(r"\s*[\(（].*?[\)）]", "", name).strip().lower()
        price_map.setdefault(base, []).append((float(inp), float(out)))

    for base, prices in price_map.items():
        price_map[base] = min(prices, key=lambda x: x[0])

    for m in models:
        clean = re.sub(r"\s*[\(（].*?[\)）]", "", m["name"]).strip().lower()
        if clean in price_map:
            inp, out = price_map[clean]
            m["price_input"] = round(inp / 1000 * 2 * EXCHANGE_RATE_USD_TO_CNY, 6)
            m["price_output"] = round(out / 1000 * 2 * EXCHANGE_RATE_USD_TO_CNY, 6)

    # Cloud models with no listed price (including "free" marketed ones) should
    # not actually be free; assign a low fallback price. Local Ollama stays free.
    for m in models:
        if (
            m["provider"] != "ollama"
            and m["price_input"] == 0.0
            and m["price_output"] == 0.0
        ):
            m["price_input"] = 0.0013
            m["price_output"] = 0.0026

    # Kimi section
    kimi_text = text.split("3.Kimi")[1] if "3.Kimi" in text else ""
    kimi_rows = re.findall(
        r"^(?:Kimi\s+)?([A-Za-z0-9\.\s\-]+?)\s+\$([0-9\.]+)\s+\$([0-9\.]+)\s+\$([0-9\.]+)\s+-$",
        kimi_text,
        re.MULTILINE,
    )
    for suffix, inp, out, cached in kimi_rows:
        suffix = suffix.strip()
        if "2.7" in suffix:
            mid = "kimi-k2-7-code"
            name = "Kimi K2.7 Code"
        elif "2.6" in suffix:
            mid = "kimi-k2-6"
            name = "Kimi K2.6"
        elif "2.5" in suffix:
            mid = "kimi-k2-5"
            name = "Kimi K2.5"
        else:
            mid = "kimi-" + suffix.lower().replace(".", "-").replace(" ", "-")
            name = "Kimi " + suffix
        models.append({
            "name": name,
            "id": mid,
            "provider_model_id": mid,
            "provider": "kimi",
            "api_type": "chat",
            "price_input": round(float(inp) / 1000 * 2 * EXCHANGE_RATE_USD_TO_CNY, 6),
            "price_output": round(float(out) / 1000 * 2 * EXCHANGE_RATE_USD_TO_CNY, 6),
            "currency": "CNY",
        })

    # DeepSeek direct models (official CNY price * markup)
    for name, mid in [
        ("DeepSeek V4 Pro", "deepseek-v4-pro"),
        ("DeepSeek V4 Flash", "deepseek-v4-flash"),
    ]:
        official = DEEPSEEK_OFFICIAL_PRICES[mid]
        models.append({
            "name": name,
            "id": mid,
            "provider_model_id": mid,
            "provider": "deepseek",
            "api_type": "chat",
            "price_input": round(official["input"] / 1000 * DEEPSEEK_MARKUP, 6),
            "price_output": round(official["output"] / 1000 * DEEPSEEK_MARKUP, 6),
            "currency": "CNY",
        })

    # Deduplicate by id
    seen = set()
    unique = []
    for m in models:
        if m["id"] not in seen:
            seen.add(m["id"])
            unique.append(m)
    return unique


def context_length_for(model: dict) -> int:
    name = model["name"].lower()
    if "long" in name or ">256k" in name or ">272k" in name:
        return 1_000_000
    if "256k" in name or "272k" in name or "200k" in name:
        return 256_000
    if "k2.7" in name or "k2.6" in name or "k2.5" in name:
        return 256_000
    return 128_000


def capability_tags(model: dict) -> list:
    name = model["name"].lower()
    tags = ["cloud"]
    if "codex" in name or "code" in name:
        tags.append("coding")
    if "chinese" in name or "qwen" in name or "glm" in name or "kimi" in name.lower():
        tags.append("chinese")
    if "flash" in name or "nano" in name or "mini" in name or "free" in name:
        tags.append("fast")
    if "opus" in name or "fable" in name or "pro" in name or "max" in name or "sol" in name:
        tags.append("reasoning")
    if context_length_for(model) >= 256_000:
        tags.append("long_context")
    return tags


def seed_db(models):
    db = SessionLocal()
    try:
        new_ids = {m["id"] for m in models}

        # Deactivate old non-Ollama models that are no longer in the doc
        for old in db.query(LLMModel).filter(LLMModel.provider != "ollama").all():
            if old.id not in new_ids:
                old.is_active = False

        # Upsert models from the supplier doc
        for idx, m in enumerate(models):
            existing = db.query(LLMModel).filter(LLMModel.id == m["id"]).first()
            if existing:
                existing.name = m["name"]
                existing.provider = m["provider"]
                existing.provider_model_id = m["provider_model_id"]
                existing.description = f"{m['name']} via {m['provider']}"
                existing.is_active = True
                existing.is_system = True
                existing.supports_streaming = True
                existing.context_length = context_length_for(m)
                existing.sort_order = idx
                existing.cost_input_per_1k = m["price_input"]
                existing.cost_output_per_1k = m["price_output"]
                existing.price_input_per_1k = m["price_input"]
                existing.price_output_per_1k = m["price_output"]
                existing.currency = m["currency"]
            else:
                db.add(LLMModel(
                    id=m["id"],
                    name=m["name"],
                    provider=m["provider"],
                    provider_model_id=m["provider_model_id"],
                    description=f"{m['name']} via {m['provider']}",
                    is_active=True,
                    is_system=True,
                    supports_streaming=True,
                    context_length=context_length_for(m),
                    sort_order=idx,
                    cost_input_per_1k=m["price_input"],
                    cost_output_per_1k=m["price_output"],
                    price_input_per_1k=m["price_input"],
                    price_output_per_1k=m["price_output"],
                    currency=m["currency"],
                ))

        # Create/update provider accounts with empty API keys
        providers = {
            "opencode": {
                "name": "OpenCode",
                "base_url": "https://opencode.ai",
                "api_key": "",
            },
            "deepseek": {
                "name": "DeepSeek",
                "base_url": "https://api.deepseek.com",
                "api_key": "",
            },
            "kimi": {
                "name": "Kimi",
                "base_url": "https://api.moonshot.cn",
                "api_key": "",
            },
        }
        for provider, cfg in providers.items():
            existing = db.query(ModelProviderAccount).filter(
                ModelProviderAccount.provider == provider,
                ModelProviderAccount.name == "default",
            ).first()
            if existing:
                existing.api_key = cfg["api_key"]
                existing.base_url = cfg["base_url"]
                existing.is_active = True
            else:
                db.add(ModelProviderAccount(
                    id=f"prov_{provider}_default",
                    provider=provider,
                    name="default",
                    api_key=cfg["api_key"],
                    base_url=cfg["base_url"],
                    balance_cny=0,
                    balance_usd=0,
                    is_active=True,
                    priority=0,
                ))

        db.commit()
        print(f"Seeded {len(models)} models and 3 provider accounts.")
    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()


def generate_backend_config(models):
    lines = ['        # ─── Supplier models (auto-generated from 模型接口和价格供应商.md) ───']
    for m in models:
        tags = capability_tags(m)
        lines.append(f'        "{m["id"]}": {{')
        lines.append(f'            "provider": ModelProvider.{m["provider"].upper()},')
        lines.append(f'            "name": "{m["name"]}",')
        lines.append(f'            "description": "{m["name"]} via {m["provider"]}",')
        lines.append(f'            "capabilities": {tags},')
        lines.append(f'            "context_length": {context_length_for(m)},')
        lines.append('            "temperature": 0.7,')
        if m["provider"] == "opencode":
            lines.append('            "endpoint": settings.OPENCODE_BASE_URL,')
        elif m["provider"] == "deepseek":
            lines.append('            "endpoint": settings.DEEPSEEK_BASE_URL,')
        elif m["provider"] == "kimi":
            lines.append('            "endpoint": settings.KIMI_BASE_URL,')
        lines.append(f'            "model_id": "{m["provider_model_id"]}",')
        if m["provider"] == "opencode":
            lines.append('            "available": bool(settings.OPENCODE_API_KEY),')
        elif m["provider"] == "deepseek":
            lines.append('            "available": bool(settings.DEEPSEEK_API_KEY),')
        elif m["provider"] == "kimi":
            lines.append('            "available": bool(settings.KIMI_API_KEY),')
        lines.append('        },')
    return "\n".join(lines)


def generate_frontend_config(models):
        # frontend uses lucide-react icons: Server, Code, Brain, Globe, Zap, Sparkles
    provider_icons = {
        "opencode": "Brain",
        "deepseek": "Sparkles",
        "kimi": "Code",
    }
    provider_colors = {
        "opencode": "text-cyan-400",
        "deepseek": "text-rose-400",
        "kimi": "text-violet-400",
    }
    provider_key_field = {
        "opencode": "opencode_api_key",
        "deepseek": "deepseek_api_key",
        "kimi": "kimi_api_key",
    }
    provider_key_label = {
        "opencode": "OpenCode API Key",
        "deepseek": "DeepSeek API Key",
        "kimi": "Kimi API Key",
    }

    lines = []
    for m in models:
        tags = capability_tags(m)
        # remove cloud tag for UI
        ui_tags = [t for t in tags if t != "cloud"]
        # map tag names to Chinese
        tag_names = {
            "coding": "代码",
            "chinese": "中文",
            "fast": "快速",
            "reasoning": "推理",
            "long_context": f"{context_length_for(m) // 1000}K上下文",
        }
        tag_str = ", ".join(f'"{tag_names.get(t, t)}"' for t in ui_tags[:3])
        ctx = f"{context_length_for(m) // 1000}K"
        lines.append("  {")
        lines.append(f"    id: '{m['id']}',")
        lines.append(f"    name: '{m['name']}',")
        lines.append(f"    provider: '{m['provider']}',")
        lines.append(f"    model: '{m['provider_model_id']}',")
        lines.append(f"    icon: {provider_icons.get(m['provider'], 'Brain')},")
        lines.append(f"    color: '{provider_colors.get(m['provider'], 'text-cyan-400')}',")
        lines.append(f"    desc: '{m['name']} via {m['provider']}',")
        lines.append(f"    tags: [{tag_str}],")
        lines.append(f"    context: '{ctx}',")
        lines.append("    requiresKey: true,")
        lines.append(f"    keyField: '{provider_key_field[m['provider']]}',")
        lines.append(f"    keyLabel: '{provider_key_label[m['provider']]}',")
        lines.append("  },")
    return "\n".join(lines)


def main():
    models = parse_doc()
    seed_db(models)

    out_dir = Path(__file__).parent
    backend_cfg = generate_backend_config(models)
    frontend_cfg = generate_frontend_config(models)

    (out_dir / "generated_backend_model_config.txt").write_text(backend_cfg, encoding="utf-8")
    (out_dir / "generated_frontend_models.txt").write_text(frontend_cfg, encoding="utf-8")

    print("Generated config snippets:")
    print(f"  - {out_dir / 'generated_backend_model_config.txt'}")
    print(f"  - {out_dir / 'generated_frontend_models.txt'}")


if __name__ == "__main__":
    main()