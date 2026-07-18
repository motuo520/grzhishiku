import { FC, Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import AdminRoute from './components/auth/AdminRoute';
import ErrorBoundary from './components/ErrorBoundary';
import ModuleLayout from './components/navigation/ModuleLayout';
import InsufficientBalanceListener from './components/llm/InsufficientBalanceListener';
import SubscriptionUpgradeListener from './components/billing/SubscriptionUpgradeListener';

// ── Auth & Layout (not lazy: instant load for welcome) ──
import WelcomePage from './pages/WelcomePage';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/store/settings';
import { getActiveProvider } from '@/api/llm';

// ── Lazy-loaded pages ───────────────────────────────
const Dashboard = lazy(() => import('./pages/Dashboard'));
const IngestPage = lazy(() => import('./pages/ingest/IngestPage'));
const GraphLayout = lazy(() => import('./pages/graph/GraphLayout'));
const GraphNetworkPage = lazy(() => import('./pages/graph/GraphNetworkPage'));
const GraphQueryPage = lazy(() => import('./pages/graph/GraphQueryPage'));
const KnowledgeDetail = lazy(() => import('./pages/knowledge/KnowledgeDetail'));
const NetworkKnowledgePage = lazy(() => import('./pages/knowledge/NetworkKnowledgePage'));
const PersonalKnowledgePage = lazy(() => import('./pages/knowledge/PersonalKnowledgePage'));
const KnowledgeCreatePage = lazy(() => import('./pages/knowledge/KnowledgeCreatePage'));
const VerificationCenterPage = lazy(() => import('./pages/knowledge/VerificationCenterPage'));
const CapsuleListPage = lazy(() => import('./pages/capsules/CapsuleListPage'));
const CapsuleCreate = lazy(() => import('./pages/capsules/CapsuleCreate'));
const CapsuleDetail = lazy(() => import('./pages/capsules/CapsuleDetail'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const NotesPage = lazy(() => import('./pages/ingest/NotesPage'));
const StickyNotesPage = lazy(() => import('./pages/ingest/StickyNotesPage'));
const TagsPage = lazy(() => import('./pages/ingest/TagsPage'));
const NoteDetail = lazy(() => import('./pages/ingest/NoteDetail'));
const ClipperPage = lazy(() => import('./pages/ingest/ClipperPage'));
const BookmarksPage = lazy(() => import('./pages/ingest/BookmarksPage'));
const EmailPage = lazy(() => import('./pages/ingest/EmailPage'));
const BatchImportPage = lazy(() => import('./pages/ingest/BatchImportPage'));
const RssPage = lazy(() => import('./pages/ingest/RssPage'));
const SocialPage = lazy(() => import('./pages/ingest/SocialPage'));
const ReadLaterPage = lazy(() => import('./pages/ingest/ReadLaterPage'));
const DocumentLibraryPage = lazy(() => import('./pages/ingest/DocumentLibraryPage'));
const SourcePoolPage = lazy(() => import('./pages/emergence/SourcePoolPage'));
const PaymentPage = lazy(() => import('./pages/PaymentPage'));
const PaymentSuccessPage = lazy(() => import('./pages/PaymentSuccessPage'));
const PaymentCancelPage = lazy(() => import('./pages/PaymentCancelPage'));
const TopupPage = lazy(() => import('./pages/TopupPage'));
const BillingPage = lazy(() => import('./pages/BillingPage'));
const SearchPage = lazy(() => import('./pages/search/SearchPage'));
const CommunityPage = lazy(() => import('./pages/community/CommunityPage'));
const GuidePage = lazy(() => import('./pages/community/GuidePage'));

// Pipeline
const PipelineOverviewPage = lazy(() => import('./pages/pipeline/PipelineOverviewPage'));
const RawMaterialsPage = lazy(() => import('./pages/pipeline/RawMaterialsPage'));
import CardsPage from './pages/pipeline/CardsPage';
const ExtractPage = lazy(() => import('./pages/pipeline/ExtractPage'));
const PipelineCollisionPage = lazy(() => import('./pages/pipeline/CollisionPage'));
const AnnotatePage = lazy(() => import('./pages/pipeline/AnnotatePage'));

// Daily Review
const DailyReviewPage = lazy(() => import('./pages/jianghu/DailyReviewPage'));

// Embodied Cognition

// Admin
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminContent = lazy(() => import('./pages/admin/AdminContent'));
const AdminBilling = lazy(() => import('./pages/admin/AdminBilling'));
const AdminModels = lazy(() => import('./pages/admin/AdminModels'));
const AdminSystem = lazy(() => import('./pages/admin/AdminSystem'));
const AdminLogs = lazy(() => import('./pages/admin/AdminLogs'));
const AdminSupport = lazy(() => import('./pages/admin/AdminSupport'));
const AdminTenants = lazy(() => import('./pages/admin/AdminTenants'));

// ── Skeleton fallback ───────────────────────────────
const PageSkeleton: FC = () => (
  <div className="min-h-[60vh] animate-pulse space-y-6 p-6">
    <div className="h-8 bg-bg-tertiary rounded-lg w-1/3" />
    <div className="h-4 bg-bg-tertiary rounded-lg w-2/3" />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="h-32 bg-bg-tertiary rounded-xl" />
      <div className="h-32 bg-bg-tertiary rounded-xl" />
      <div className="h-32 bg-bg-tertiary rounded-xl" />
    </div>
    <div className="h-48 bg-bg-tertiary rounded-xl" />
  </div>
);

const AuthGuard: FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoading, isLoggedIn } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="w-8 h-8 border-2 border-info border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Redirect logged-in users from welcome page to dashboard
  if (isLoggedIn && (location.pathname === '/' || location.pathname === '/welcome')) {
    return <Navigate to="/app" replace />;
  }

  // Show welcome page for non-logged-in users
  if (!isLoggedIn && (location.pathname === '/' || location.pathname === '/welcome')) {
    return <WelcomePage />;
  }

  return <>{children}</>;
};

const App: FC = () => {
  const { isLoggedIn } = useAuth();
  const syncActiveProvider = useSettings((state) => state.syncActiveProvider);

  useEffect(() => {
    if (!isLoggedIn) return;
    getActiveProvider()
      .then((data) => {
        if (data.provider && data.model) {
          syncActiveProvider(data.provider, data.model);
        }
      })
      .catch(() => {
        // Ignore: user might not have set an active provider yet
      });
  }, [isLoggedIn, syncActiveProvider]);

  return (
    <ErrorBoundary>
      <Suspense fallback={<PageSkeleton />}>
        <InsufficientBalanceListener />
        <SubscriptionUpgradeListener />
        <Routes>
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/payment/success" element={<PaymentSuccessPage />} />
          <Route path="/payment/cancel" element={<PaymentCancelPage />} />
          <Route
            path="/*"
            element={
              <AuthGuard>
                <AppLayout />
              </AuthGuard>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="app" element={<Dashboard />} />

            {/* Ingest */}
            <Route path="ingest" element={<ModuleLayout menuId="ingest" />}>
              <Route index element={<IngestPage />} />
              <Route path="notes" element={<NotesPage />} />
              <Route path="notes/new" element={<NoteDetail />} />
              <Route path="notes/:id" element={<NoteDetail />} />
              <Route path="sticky-notes" element={<StickyNotesPage />} />
              <Route path="tags" element={<TagsPage />} />
              <Route path="clipper" element={<ClipperPage />} />
              <Route path="bookmarks" element={<BookmarksPage />} />
              <Route path="email" element={<EmailPage />} />
              <Route path="batch-import" element={<BatchImportPage />} />
              <Route path="rss" element={<RssPage />} />
              <Route path="social" element={<SocialPage />} />
              <Route path="read-later" element={<ReadLaterPage />} />
              <Route path="documents" element={<DocumentLibraryPage />} />
              <Route path="sources" element={<SourcePoolPage />} />
            </Route>

            {/* Graph */}
            <Route path="graph" element={<GraphLayout />}>
              <Route index element={<GraphNetworkPage />} />
              <Route path="network" element={<GraphNetworkPage />} />
              <Route path="query" element={<GraphQueryPage />} />
            </Route>

            <Route path="search" element={<SearchPage />} />
            <Route path="community" element={<CommunityPage />} />
            <Route path="community/guide" element={<GuidePage />} />
            <Route path="daily-review" element={<DailyReviewPage />} />


            {/* Capsules */}
            <Route path="capsules" element={<Navigate to="/capsules/my" replace />} />
            <Route path="capsules/my" element={<CapsuleListPage />} />
            <Route path="capsules/create" element={<CapsuleCreate />} />
            <Route path="capsules/:id" element={<CapsuleDetail />} />

            {/* Knowledge */}
            <Route path="knowledge" element={<Navigate to="/knowledge/network" replace />} />
            <Route path="knowledge/network" element={<NetworkKnowledgePage />} />
            <Route path="knowledge/personal" element={<PersonalKnowledgePage />} />
            <Route path="knowledge/verify" element={<VerificationCenterPage />} />
            <Route path="knowledge/create" element={<KnowledgeCreatePage />} />
            <Route path="knowledge/:id" element={<KnowledgeDetail />} />

            {/* Pipeline */}
            <Route path="pipeline" element={<ModuleLayout menuId="pipeline" />}>
              <Route index element={<PipelineOverviewPage />} />
              <Route path="raw" element={<RawMaterialsPage />} />
              <Route path="cards" element={<CardsPage />} />
              <Route path="extract" element={<ExtractPage />} />
              <Route path="collision" element={<PipelineCollisionPage />} />
              <Route path="annotate" element={<AnnotatePage />} />
            </Route>



            {/* Settings */}
            <Route path="settings" element={<ModuleLayout menuId="settings" showOverview={false} />}>
              <Route index element={<Navigate to="account" replace />} />
              <Route path="account" element={<SettingsPage />} />
              <Route path="ai" element={<SettingsPage />} />
              <Route path="privacy" element={<SettingsPage />} />
              <Route path="sync" element={<SettingsPage />} />
              <Route path="storage" element={<SettingsPage />} />
              <Route path="appearance" element={<SettingsPage />} />
              <Route path="data" element={<SettingsPage />} />
              <Route path="plugins" element={<SettingsPage />} />
            </Route>

            <Route path="payment" element={<PaymentPage />} />
            <Route path="topup" element={<TopupPage />} />
            <Route path="billing" element={<BillingPage />} />
          </Route>
          {/* Admin routes */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="content" element={<AdminContent />} />
            <Route path="billing" element={<AdminBilling />} />
            <Route path="models" element={<AdminModels />} />
            <Route path="system" element={<AdminSystem />} />
            <Route path="logs" element={<AdminLogs />} />
            <Route path="support" element={<AdminSupport />} />
            <Route path="tenants" element={<AdminTenants />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
};

export default App;
