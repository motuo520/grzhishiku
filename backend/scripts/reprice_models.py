# -*- coding: utf-8 -*-
"""按供应商原价+倍率重定 llm_models 价格，并精简激活列表。

规则（用户拍板，2026-07-18）：
- opencode：原价(USD/1M tokens) × 7.3 → RMB/1M，售价 = 成本 × 2.5
- deepseek：原价已是 RMB/1M（缓存未命中档），售价 = 成本 × 3
- kimi：同 opencode 规则 × 2.5
- cost_* = 供应商成本(RMB/1K)，price_* = 对用户售价(RMB/1K)
"""
import sqlite3
import sys

sys.stdout.reconfigure(encoding='utf-8')
RATE = 7.3          # USD -> RMB
OPENCODE_MARKUP = 2.5
DEEPSEEK_MARKUP = 3.0
KIMI_MARKUP = 2.5

# (id, 原价输入 USD/1M, 原价输出 USD/1M)
OPENCODE_USD = {
    'opencode-gpt-5-6-sol': (5.00, 30.00),
    'opencode-gpt-5-6-terra': (2.50, 15.00),
    'opencode-gpt-5-6-luna': (1.00, 6.00),
    'opencode-gpt-5-5': (5.00, 30.00),
    'opencode-gpt-5-5-pro': (30.00, 180.00),
    'opencode-gpt-5-4': (2.50, 15.00),
    'opencode-gpt-5-4-pro': (30.00, 180.00),
    'opencode-gpt-5-4-mini': (0.75, 4.50),
    'opencode-gpt-5-4-nano': (0.20, 1.25),
    'opencode-gpt-5-3-codex': (1.75, 14.00),
    'opencode-gpt-5-3-codex-spark': (1.75, 14.00),
    'opencode-gpt-5-2': (1.75, 14.00),
    'opencode-gpt-5-2-codex': (1.75, 14.00),
    'opencode-gpt-5-1': (1.07, 8.50),
    'opencode-gpt-5-1-codex': (1.07, 8.50),
    'opencode-gpt-5-1-codex-max': (1.25, 10.00),
    'opencode-gpt-5-1-codex-mini': (0.25, 2.00),
    'opencode-gpt-5': (1.07, 8.50),
    'opencode-gpt-5-codex': (1.07, 8.50),
    'opencode-gpt-5-nano': (0.05, 0.40),
    'opencode-claude-fable-5': (10.00, 50.00),
    'opencode-claude-opus-4-8': (5.00, 25.00),
    'opencode-claude-opus-4-7': (5.00, 25.00),
    'opencode-claude-opus-4-6': (5.00, 25.00),
    'opencode-claude-opus-4-5': (5.00, 25.00),
    'opencode-claude-sonnet-5': (2.00, 10.00),
    'opencode-claude-sonnet-4-6': (3.00, 15.00),
    'opencode-claude-sonnet-4-5': (3.00, 15.00),
    'opencode-claude-haiku-4-5': (1.00, 5.00),
    'opencode-gemini-3-5-flash': (1.50, 9.00),
    'opencode-gemini-3-1-pro': (2.00, 12.00),
    'opencode-gemini-3-flash': (0.50, 3.00),
    'opencode-qwen3-7-max': (2.50, 7.50),
    'opencode-qwen3-7-plus': (0.40, 1.60),
    'opencode-qwen3-6-plus': (0.50, 3.00),
    'opencode-qwen3-5-plus': (0.20, 1.20),
    'opencode-minimax-m3': (0.30, 1.20),
    'opencode-minimax-m2-7': (0.30, 1.20),
    'opencode-minimax-m2-5': (0.30, 1.20),
    'opencode-glm-5-2': (1.40, 4.40),
    'opencode-glm-5-1': (1.40, 4.40),
    'opencode-glm-5': (1.00, 3.20),
    'opencode-grok-4-5': (2.00, 6.00),
    'opencode-grok-build-0-1': (1.00, 2.00),
    # 免费模型：用户要求按 DeepSeek V4 Flash 同档计成本（见下方 FREE_AS_FLASH）
    'opencode-big-pickle': (0, 0),
}

# 免费模型按 DeepSeek V4 Flash 同档：成本 1/2 RMB/1M，售价 ×3
FREE_AS_FLASH = {
    'opencode-mimo-v2-5-free': (1.0, 2.0),
    'opencode-north-mini-code-free': (1.0, 2.0),
    'opencode-nemotron-3-ultra-free': (1.0, 2.0),
}

# (id, 原价输入 RMB/1M, 原价输出 RMB/1M) — 缓存未命中档
DEEPSEEK_RMB = {
    'deepseek-v4-pro': (3.0, 6.0),
    'deepseek-v4-flash': (1.0, 2.0),
}

KIMI_USD = {
    'kimi-k2-7-code': (0.95, 4.00),
    'kimi-k2-6': (0.95, 4.00),
    'kimi-k2-5': (0.60, 3.00),
}

# 控制台精简：这些保持/设为激活，其余 opencode 全部下架（is_active=0）
ACTIVE = [
    # ollama
    'ollama-qwen2.5-0.5b', 'ollama-smollm2',
    # opencode 精选（每族留新不留旧）
    'opencode-gpt-5-6-sol', 'opencode-gpt-5-6-terra', 'opencode-gpt-5-6-luna',
    'opencode-gpt-5-4-mini', 'opencode-gpt-5-4-nano',
    'opencode-gpt-5-3-codex-spark',
    'opencode-claude-fable-5', 'opencode-claude-opus-4-8',
    'opencode-claude-sonnet-5', 'opencode-claude-haiku-4-5',
    'opencode-gemini-3-5-flash', 'opencode-gemini-3-1-pro', 'opencode-gemini-3-flash',
    'opencode-qwen3-7-max', 'opencode-qwen3-7-plus',
    'opencode-qwen3-6-plus', 'opencode-qwen3-5-plus',
    'opencode-minimax-m3',
    'opencode-glm-5-2',
    'opencode-grok-4-5',
    'opencode-mimo-v2-5-free', 'opencode-north-mini-code-free', 'opencode-nemotron-3-ultra-free',
    # deepseek / kimi 直销
    'deepseek-v4-pro', 'deepseek-v4-flash',
    'kimi-k2-7-code', 'kimi-k2-6', 'kimi-k2-5',
]

con = sqlite3.connect('psb.db')
cur = con.cursor()

updated = 0
for mid, (i_usd, o_usd) in {**OPENCODE_USD, **KIMI_USD}.items():
    markup = KIMI_MARKUP if mid.startswith('kimi') else OPENCODE_MARKUP
    ci, co = i_usd * RATE / 1000, o_usd * RATE / 1000
    pi, po = ci * markup, co * markup
    cur.execute(
        'UPDATE llm_models SET cost_input_per_1k=?, cost_output_per_1k=?, price_input_per_1k=?, price_output_per_1k=? WHERE id=?',
        (round(ci, 6), round(co, 6), round(pi, 6), round(po, 6), mid),
    )
    updated += cur.rowcount

for mid, (i_rmb, o_rmb) in DEEPSEEK_RMB.items():
    ci, co = i_rmb / 1000, o_rmb / 1000
    pi, po = ci * DEEPSEEK_MARKUP, co * DEEPSEEK_MARKUP
    cur.execute(
        'UPDATE llm_models SET cost_input_per_1k=?, cost_output_per_1k=?, price_input_per_1k=?, price_output_per_1k=? WHERE id=?',
        (round(ci, 6), round(co, 6), round(pi, 6), round(po, 6), mid),
    )
    updated += cur.rowcount

for mid, (i_rmb, o_rmb) in FREE_AS_FLASH.items():
    ci, co = i_rmb / 1000, o_rmb / 1000
    pi, po = ci * DEEPSEEK_MARKUP, co * DEEPSEEK_MARKUP
    cur.execute(
        'UPDATE llm_models SET cost_input_per_1k=?, cost_output_per_1k=?, price_input_per_1k=?, price_output_per_1k=? WHERE id=?',
        (round(ci, 6), round(co, 6), round(pi, 6), round(po, 6), mid),
    )
    updated += cur.rowcount

# 精简激活 + 重排 sort_order
cur.execute('UPDATE llm_models SET is_active=0')
for idx, mid in enumerate(ACTIVE):
    cur.execute('UPDATE llm_models SET is_active=1, sort_order=? WHERE id=?', (idx + 1, mid))
    updated += cur.rowcount

con.commit()

active = cur.execute('SELECT count(*) FROM llm_models WHERE is_active=1').fetchone()[0]
print(f'价格更新 {updated} 行；当前激活 {active} 个模型')
for r in cur.execute(
    'SELECT id, cost_input_per_1k, cost_output_per_1k, price_input_per_1k, price_output_per_1k FROM llm_models WHERE is_active=1 ORDER BY sort_order'
).fetchall():
    print('|'.join(str(x) for x in r))
con.close()
