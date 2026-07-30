import { FC, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { User, Brain, Shield, RefreshCw, Palette, Database, Puzzle, HardDrive, Monitor } from 'lucide-react';
import AccountSettings from './AccountSettings';
import AISettings from './AISettings';
import PrivacySettings from './PrivacySettings';
import SyncSettings from './SyncSettings';
import AppearanceSettings from './AppearanceSettings';
import DataSettings from './DataSettings';
import StorageSettings from './StorageSettings';
import PluginsSettings from './PluginsSettings';
import DesktopSettings from './DesktopSettings';

type TabId = 'desktop' | 'account' | 'ai' | 'privacy' | 'sync' | 'appearance' | 'data' | 'storage' | 'plugins';

interface Tab {
  id: TabId;
  label: string;
  icon: typeof User;
  component: FC;
}

const TABS: Tab[] = [
  { id: 'desktop', label: '桌面端', icon: Monitor, component: DesktopSettings },
  { id: 'account', label: '账户', icon: User, component: AccountSettings },
  { id: 'ai', label: 'AI 设置', icon: Brain, component: AISettings },
  { id: 'privacy', label: '隐私', icon: Shield, component: PrivacySettings },
  { id: 'sync', label: '同步', icon: RefreshCw, component: SyncSettings },
  { id: 'storage', label: '存储', icon: HardDrive, component: StorageSettings },
  { id: 'appearance', label: '外观', icon: Palette, component: AppearanceSettings },
  { id: 'data', label: '数据', icon: Database, component: DataSettings },
  { id: 'plugins', label: '插件', icon: Puzzle, component: PluginsSettings },
];

const VALID_TAB_IDS = new Set(TABS.map(t => t.id));

const SettingsPage: FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab: TabId = useMemo(() => {
    const segment = location.pathname.replace('/settings/', '').replace('/settings', '') || 'account';
    return VALID_TAB_IDS.has(segment as TabId) ? (segment as TabId) : 'account';
  }, [location.pathname]);

  const ActiveComponent = TABS.find(t => t.id === activeTab)?.component ?? AccountSettings;

  useEffect(() => {
    // If someone lands on /settings without a tab, redirect to /settings/account
    if (location.pathname === '/settings') {
      navigate('/settings/account', { replace: true });
    }
  }, [location.pathname, navigate]);

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in">
      <ActiveComponent />
    </div>
  );
};

export default SettingsPage;
