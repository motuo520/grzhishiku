import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, Server, RefreshCw, Plus, Trash2, Edit2, Save, X,
  Eye, EyeOff, AlertCircle, DollarSign, ToggleLeft, ToggleRight,
} from 'lucide-react';
import adminApi from '../../services/adminApi';

interface LLMModel {
  id: string;
  name: string;
  provider: string;
  provider_model_id: string;
  description?: string;
  is_active: boolean;
  is_system: boolean;
  supports_streaming: boolean;
  context_length: number;
  sort_order: number;
  cost_input_per_1k: number;
  cost_output_per_1k: number;
  price_input_per_1k: number;
  price_output_per_1k: number;
  currency: string;
}

interface ProviderAccount {
  id: string;
  name: string;
  provider: string;
  base_url?: string;
  balance_cny: number;
  balance_usd: number;
  is_active: boolean;
  priority: number;
  failure_count: number;
  last_failure_at?: string;
  last_success_at?: string;
}

const PROVIDERS = ['ollama', 'deepseek', 'kimi', 'opencode'];

function currency(n?: number) {
  return (n || 0).toFixed(6);
}

export default function AdminModels() {
  const [tab, setTab] = useState<'models' | 'providers'>('models');
  const [models, setModels] = useState<LLMModel[]>([]);
  const [providers, setProviders] = useState<ProviderAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [showKeyFor, setShowKeyFor] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState<Partial<ProviderAccount & { api_key: string }>>({});
  const [createModelOpen, setCreateModelOpen] = useState(false);
  const [createProviderOpen, setCreateProviderOpen] = useState(false);
  const [newModel, setNewModel] = useState<Partial<LLMModel>>({
    provider: 'deepseek',
    is_active: true,
    is_system: false,
    supports_streaming: true,
    context_length: 128000,
    currency: 'CNY',
  });
  const [newProvider, setNewProvider] = useState<Partial<ProviderAccount & { api_key: string }>>({
    provider: 'deepseek',
    name: 'default',
    is_active: true,
    priority: 0,
  });

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [mRes, pRes] = await Promise.all([
        adminApi.getLLMModels(),
        adminApi.getLLMProviderAccounts(),
      ]);
      setModels(mRes.data || []);
      setProviders(pRes.data || []);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const toggleActive = async (model: LLMModel) => {
    setSavingId(model.id);
    try {
      await adminApi.updateLLMModel(model.id, { is_active: !model.is_active });
      setModels((prev) =>
        prev.map((m) => (m.id === model.id ? { ...m, is_active: !m.is_active } : m))
      );
    } catch (err: any) {
      setError(err.response?.data?.detail || '更新失败');
    } finally {
      setSavingId(null);
    }
  };

  const updatePrice = async (model: LLMModel, field: keyof LLMModel, value: string) => {
    const num = parseFloat(value);
    if (Number.isNaN(num)) return;
    setSavingId(model.id);
    try {
      await adminApi.updateLLMModel(model.id, { [field]: num });
      setModels((prev) =>
        prev.map((m) => (m.id === model.id ? { ...m, [field]: num } : m))
      );
    } catch (err: any) {
      setError(err.response?.data?.detail || '更新失败');
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (model: LLMModel) => {
    if (!confirm(`确定删除模型 ${model.name} 吗？`)) return;
    try {
      await adminApi.deleteLLMModel(model.id);
      setModels((prev) => prev.filter((m) => m.id !== model.id));
    } catch (err: any) {
      setError(err.response?.data?.detail || '删除失败');
    }
  };

  const handleCreate = async () => {
    if (!newModel.id || !newModel.name || !newModel.provider_model_id) {
      setError('请填写完整模型信息');
      return;
    }
    try {
      const res = await adminApi.createLLMModel(newModel as LLMModel);
      setModels((prev) => [...prev, res.data]);
      setCreateModelOpen(false);
      setNewModel({
        provider: 'deepseek',
        is_active: true,
        is_system: false,
        supports_streaming: true,
        context_length: 128000,
        currency: 'CNY',
      });
    } catch (err: any) {
      setError(err.response?.data?.detail || '创建失败');
    }
  };

  const startEditProvider = (p: ProviderAccount) => {
    setEditingProviderId(p.id);
    setProviderForm({ ...p, api_key: '' });
    setShowKeyFor(null);
  };

  const saveProvider = async () => {
    if (!editingProviderId) return;
    try {
      const payload: any = {
        base_url: providerForm.base_url,
        is_active: providerForm.is_active,
        priority: Number(providerForm.priority || 0),
        balance_cny: Number(providerForm.balance_cny || 0),
        balance_usd: Number(providerForm.balance_usd || 0),
      };
      if (providerForm.api_key) {
        payload.api_key = providerForm.api_key;
      }
      const res = await adminApi.updateLLMProviderAccount(editingProviderId, payload);
      setProviders((prev) =>
        prev.map((p) => (p.id === editingProviderId ? res.data : p))
      );
      setEditingProviderId(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || '保存失败');
    }
  };

  const handleCreateProvider = async () => {
    if (!newProvider.provider || !newProvider.name || !newProvider.api_key) {
      setError('请填写完整厂商账户信息');
      return;
    }
    try {
      const res = await adminApi.createLLMProviderAccount({
        provider: newProvider.provider,
        name: newProvider.name,
        api_key: newProvider.api_key,
        base_url: newProvider.base_url,
        is_active: newProvider.is_active ?? true,
        priority: Number(newProvider.priority ?? 0),
        balance_cny: Number(newProvider.balance_cny ?? 0),
        balance_usd: Number(newProvider.balance_usd ?? 0),
      });
      setProviders((prev) => [...prev, res.data]);
      setCreateProviderOpen(false);
      setNewProvider({
        provider: 'deepseek',
        name: 'default',
        is_active: true,
        priority: 0,
      });
    } catch (err: any) {
      setError(err.response?.data?.detail || '创建失败');
    }
  };

  const filteredModels = useMemo(() => {
    return [...models].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [models]);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">模型与厂商配置</h1>
          <p className="text-admin-muted">管理 LLM 模型目录与上游厂商账户</p>
        </div>
        <div className="h-64 bg-admin-sidebar rounded-xl border border-admin-border animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">模型与厂商配置</h1>
          <p className="text-admin-muted">管理 LLM 模型目录与上游厂商账户</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('models')}
            className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
              tab === 'models'
                ? 'bg-admin-primary text-white'
                : 'bg-admin-sidebar text-admin-muted hover:text-white border border-admin-border'
            }`}
          >
            <Cpu className="w-4 h-4" />
            模型目录
          </button>
          <button
            onClick={() => setTab('providers')}
            className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
              tab === 'providers'
                ? 'bg-admin-primary text-white'
                : 'bg-admin-sidebar text-admin-muted hover:text-white border border-admin-border'
            }`}
          >
            <Server className="w-4 h-4" />
            厂商账户
          </button>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-2 bg-admin-sidebar border border-admin-border rounded-lg text-sm text-admin-muted hover:text-white hover:bg-admin-hover transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {tab === 'models' ? (
          <motion.div
            key="models"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex justify-end">
              <button
                onClick={() => setCreateModelOpen(true)}
                className="flex items-center gap-2 px-3 py-2 bg-admin-primary hover:bg-admin-primary/90 text-white rounded-lg text-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                新增模型
              </button>
            </div>

            <div className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="border-b border-admin-border bg-admin-bg/50 text-left text-sm text-admin-muted">
                      <th className="px-4 py-3 font-medium">模型</th>
                      <th className="px-4 py-3 font-medium">厂商</th>
                      <th className="px-4 py-3 font-medium">上游模型 ID</th>
                      <th className="px-4 py-3 font-medium">输入价/1K</th>
                      <th className="px-4 py-3 font-medium">输出价/1K</th>
                      <th className="px-4 py-3 font-medium">上下文</th>
                      <th className="px-4 py-3 font-medium">流式</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredModels.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-admin-border hover:bg-admin-hover/50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="text-sm text-white font-medium">{m.name}</div>
                          <div className="text-xs text-admin-muted">{m.id}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-white capitalize">{m.provider}</td>
                        <td className="px-4 py-3 text-sm text-admin-muted font-mono">{m.provider_model_id}</td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            step="0.000001"
                            defaultValue={currency(m.price_input_per_1k)}
                            onBlur={(e) => updatePrice(m, 'price_input_per_1k', e.target.value)}
                            disabled={savingId === m.id}
                            className="w-28 px-2 py-1 bg-admin-bg border border-admin-border rounded text-sm text-white focus:outline-none focus:border-admin-primary disabled:opacity-50"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            step="0.000001"
                            defaultValue={currency(m.price_output_per_1k)}
                            onBlur={(e) => updatePrice(m, 'price_output_per_1k', e.target.value)}
                            disabled={savingId === m.id}
                            className="w-28 px-2 py-1 bg-admin-bg border border-admin-border rounded text-sm text-white focus:outline-none focus:border-admin-primary disabled:opacity-50"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-admin-muted">{m.context_length.toLocaleString()}</td>
                        <td className="px-4 py-3">
                          {m.supports_streaming ? (
                            <span className="text-xs text-success">支持</span>
                          ) : (
                            <span className="text-xs text-admin-muted">否</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleActive(m)}
                            disabled={savingId === m.id}
                            className="disabled:opacity-50"
                          >
                            {m.is_active ? (
                              <ToggleRight className="w-6 h-6 text-success" />
                            ) : (
                              <ToggleLeft className="w-6 h-6 text-admin-muted" />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!m.is_system && (
                            <button
                              onClick={() => handleDelete(m)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-danger hover:bg-danger/10 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              删除
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredModels.length === 0 && (
                <div className="p-8 text-center text-admin-muted">
                  <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>暂无模型配置</p>
                </div>
              )}
            </div>

            {createModelOpen && (
              <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-admin-sidebar border border-admin-border rounded-xl w-full max-w-lg p-6 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">新增模型</h3>
                    <button onClick={() => setCreateModelOpen(false)} className="text-admin-muted hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs text-admin-muted mb-1">模型 ID</label>
                      <input
                        value={newModel.id || ''}
                        onChange={(e) => setNewModel({ ...newModel, id: e.target.value })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                        placeholder="例如 deepseek-v4-pro"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-admin-muted mb-1">显示名称</label>
                      <input
                        value={newModel.name || ''}
                        onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-admin-muted mb-1">厂商</label>
                      <select
                        value={newModel.provider || 'deepseek'}
                        onChange={(e) => setNewModel({ ...newModel, provider: e.target.value })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      >
                        {PROVIDERS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-admin-muted mb-1">上游模型 ID</label>
                      <input
                        value={newModel.provider_model_id || ''}
                        onChange={(e) => setNewModel({ ...newModel, provider_model_id: e.target.value })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-admin-muted mb-1">输入价 / 1K</label>
                      <input
                        type="number"
                        step="0.000001"
                        value={newModel.price_input_per_1k ?? 0}
                        onChange={(e) => setNewModel({ ...newModel, price_input_per_1k: parseFloat(e.target.value) })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-admin-muted mb-1">输出价 / 1K</label>
                      <input
                        type="number"
                        step="0.000001"
                        value={newModel.price_output_per_1k ?? 0}
                        onChange={(e) => setNewModel({ ...newModel, price_output_per_1k: parseFloat(e.target.value) })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-admin-muted mb-1">上下文长度</label>
                      <input
                        type="number"
                        value={newModel.context_length || 128000}
                        onChange={(e) => setNewModel({ ...newModel, context_length: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-admin-muted mb-1">排序</label>
                      <input
                        type="number"
                        value={newModel.sort_order || 0}
                        onChange={(e) => setNewModel({ ...newModel, sort_order: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => setCreateModelOpen(false)}
                      className="px-4 py-2 rounded-lg text-sm text-admin-muted hover:text-white border border-admin-border"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleCreate}
                      className="px-4 py-2 rounded-lg text-sm bg-admin-primary text-white hover:bg-admin-primary/90"
                    >
                      创建
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="providers"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex justify-end">
              <button
                onClick={() => setCreateProviderOpen(true)}
                className="flex items-center gap-2 px-3 py-2 bg-admin-primary hover:bg-admin-primary/90 text-white rounded-lg text-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                新增账户
              </button>
            </div>

            <div className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="border-b border-admin-border bg-admin-bg/50 text-left text-sm text-admin-muted">
                      <th className="px-4 py-3 font-medium">厂商 / 名称</th>
                      <th className="px-4 py-3 font-medium">Base URL</th>
                      <th className="px-4 py-3 font-medium">API Key</th>
                      <th className="px-4 py-3 font-medium">余额</th>
                      <th className="px-4 py-3 font-medium">优先级</th>
                      <th className="px-4 py-3 font-medium">健康度</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((p) => {
                      const isEditing = editingProviderId === p.id;
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-admin-border hover:bg-admin-hover/50 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="text-sm text-white font-medium capitalize">{p.provider}</div>
                            <div className="text-xs text-admin-muted">{p.name}</div>
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                value={providerForm.base_url || ''}
                                onChange={(e) => setProviderForm({ ...providerForm, base_url: e.target.value })}
                                className="w-full min-w-[200px] px-2 py-1 bg-admin-bg border border-admin-border rounded text-sm text-white"
                              />
                            ) : (
                              <div className="text-sm text-admin-muted">{p.base_url || '-'}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type={showKeyFor === p.id ? 'text' : 'password'}
                                  value={providerForm.api_key || ''}
                                  placeholder="留空表示不修改"
                                  onChange={(e) => setProviderForm({ ...providerForm, api_key: e.target.value })}
                                  className="w-40 px-2 py-1 bg-admin-bg border border-admin-border rounded text-sm text-white"
                                />
                                <button onClick={() => setShowKeyFor(showKeyFor === p.id ? null : p.id)}>
                                  {showKeyFor === p.id ? (
                                    <EyeOff className="w-4 h-4 text-admin-muted" />
                                  ) : (
                                    <Eye className="w-4 h-4 text-admin-muted" />
                                  )}
                                </button>
                              </div>
                            ) : (
                              <span className="text-sm text-admin-muted">••••••••</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <div className="space-y-1">
                                <input
                                  type="number"
                                  step="0.0001"
                                  value={providerForm.balance_cny ?? 0}
                                  onChange={(e) => setProviderForm({ ...providerForm, balance_cny: parseFloat(e.target.value) })}
                                  className="w-28 px-2 py-1 bg-admin-bg border border-admin-border rounded text-sm text-white"
                                />
                                <input
                                  type="number"
                                  step="0.0001"
                                  value={providerForm.balance_usd ?? 0}
                                  onChange={(e) => setProviderForm({ ...providerForm, balance_usd: parseFloat(e.target.value) })}
                                  className="w-28 px-2 py-1 bg-admin-bg border border-admin-border rounded text-sm text-white"
                                />
                              </div>
                            ) : (
                              <div className="text-sm text-white">
                                <div>¥{p.balance_cny.toFixed(4)}</div>
                                <div className="text-admin-muted">${p.balance_usd.toFixed(4)}</div>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                type="number"
                                value={providerForm.priority ?? 0}
                                onChange={(e) => setProviderForm({ ...providerForm, priority: parseInt(e.target.value) })}
                                className="w-20 px-2 py-1 bg-admin-bg border border-admin-border rounded text-sm text-white"
                              />
                            ) : (
                              <div className="text-sm text-admin-muted">{p.priority}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {p.failure_count > 0 ? (
                              <div className="text-xs text-danger">
                                失败 {p.failure_count} 次
                                {p.last_failure_at && <div>{new Date(p.last_failure_at).toLocaleString()}</div>}
                              </div>
                            ) : p.last_success_at ? (
                              <div className="text-xs text-success">
                                正常
                                <div>{new Date(p.last_success_at).toLocaleString()}</div>
                              </div>
                            ) : (
                              <span className="text-xs text-admin-muted">未使用</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <button
                                onClick={() => setProviderForm({ ...providerForm, is_active: !providerForm.is_active })}
                              >
                                {providerForm.is_active ? (
                                  <ToggleRight className="w-6 h-6 text-success" />
                                ) : (
                                  <ToggleLeft className="w-6 h-6 text-admin-muted" />
                                )}
                              </button>
                            ) : (
                              <span
                                className={`inline-flex px-2 py-1 rounded-full text-xs ${
                                  p.is_active ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                                }`}
                              >
                                {p.is_active ? '启用' : '禁用'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {isEditing ? (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={saveProvider}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-success hover:bg-success/10 rounded"
                                >
                                  <Save className="w-3.5 h-3.5" />
                                  保存
                                </button>
                                <button
                                  onClick={() => setEditingProviderId(null)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-admin-muted hover:bg-admin-hover rounded"
                                >
                                  <X className="w-3.5 h-3.5" />
                                  取消
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEditProvider(p)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-admin-primary hover:bg-admin-primary/10 rounded"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                编辑
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {providers.length === 0 && (
                <div className="p-8 text-center text-admin-muted">
                  <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>暂无厂商账户</p>
                </div>
              )}
            </div>

            {createProviderOpen && (
              <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-admin-sidebar border border-admin-border rounded-xl w-full max-w-lg p-6 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">新增厂商账户</h3>
                    <button onClick={() => setCreateProviderOpen(false)} className="text-admin-muted hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-admin-muted mb-1">厂商</label>
                      <select
                        value={newProvider.provider || 'deepseek'}
                        onChange={(e) => setNewProvider({ ...newProvider, provider: e.target.value })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      >
                        {PROVIDERS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-admin-muted mb-1">账户名称</label>
                      <input
                        value={newProvider.name || ''}
                        onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
                        placeholder="default"
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-admin-muted mb-1">API Key</label>
                      <input
                        type="password"
                        value={newProvider.api_key || ''}
                        onChange={(e) => setNewProvider({ ...newProvider, api_key: e.target.value })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-admin-muted mb-1">Base URL</label>
                      <input
                        value={newProvider.base_url || ''}
                        onChange={(e) => setNewProvider({ ...newProvider, base_url: e.target.value })}
                        placeholder="可选，留空使用默认地址"
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-admin-muted mb-1">优先级</label>
                      <input
                        type="number"
                        value={newProvider.priority ?? 0}
                        onChange={(e) => setNewProvider({ ...newProvider, priority: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-admin-muted mb-1">状态</label>
                      <select
                        value={newProvider.is_active ? 'active' : 'inactive'}
                        onChange={(e) => setNewProvider({ ...newProvider, is_active: e.target.value === 'active' })}
                        className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                      >
                        <option value="active">启用</option>
                        <option value="inactive">禁用</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => setCreateProviderOpen(false)}
                      className="px-4 py-2 rounded-lg text-sm text-admin-muted hover:text-white border border-admin-border"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleCreateProvider}
                      className="px-4 py-2 rounded-lg text-sm bg-admin-primary text-white hover:bg-admin-primary/90"
                    >
                      创建
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
