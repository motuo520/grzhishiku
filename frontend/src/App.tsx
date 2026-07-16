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
const GraphPathPage = lazy(() => import('./pages/graph/GraphPathPage'));
const GraphReportPage = lazy(() => import('./pages/graph/GraphReportPage'));
const GraphBridgesPage = lazy(() => import('./pages/graph/GraphBridgesPage'));
const GraphTagsPage = lazy(() => import('./pages/graph/GraphTagsPage'));
const GraphTimelinePage = lazy(() => import('./pages/graph/GraphTimelinePage'));
const AttentionDashboardPage = lazy(() => import('./pages/attention/AttentionDashboardPage'));
const AttentionDeepWorkPage = lazy(() => import('./pages/attention/AttentionDeepWorkPage'));
const AttentionBudgetPage = lazy(() => import('./pages/attention/AttentionBudgetPage'));
const AttentionGuardianPage = lazy(() => import('./pages/attention/AttentionGuardianPage'));
const AttentionRationPage = lazy(() => import('./pages/attention/AttentionRationPage'));
const AttentionStatsPage = lazy(() => import('./pages/attention/AttentionStatsPage'));
const KnowledgeDetail = lazy(() => import('./pages/knowledge/KnowledgeDetail'));
const NetworkKnowledgePage = lazy(() => import('./pages/knowledge/NetworkKnowledgePage'));
const PersonalKnowledgePage = lazy(() => import('./pages/knowledge/PersonalKnowledgePage'));
const VerificationCenterPage = lazy(() => import('./pages/knowledge/VerificationCenterPage'));
const SourceTraceabilityPage = lazy(() => import('./pages/knowledge/SourceTraceabilityPage'));
const CounterEvidenceWallPage = lazy(() => import('./pages/knowledge/CounterEvidenceWallPage'));
const CredibilityMapPage = lazy(() => import('./pages/knowledge/CredibilityMapPage'));
const TimelinessMonitorPage = lazy(() => import('./pages/knowledge/TimelinessMonitorPage'));
const KnowledgeStatsPage = lazy(() => import('./pages/knowledge/KnowledgeStatsPage'));
const KnowledgeCreatePage = lazy(() => import('./pages/knowledge/KnowledgeCreatePage'));
const CapsuleListPage = lazy(() => import('./pages/capsules/CapsuleListPage'));
const CapsuleCreate = lazy(() => import('./pages/capsules/CapsuleCreate'));
const CapsuleDetail = lazy(() => import('./pages/capsules/CapsuleDetail'));
const CapsulePlazaPage = lazy(() => import('./pages/capsules/CapsulePlazaPage'));
const CapsuleSchedulePage = lazy(() => import('./pages/capsules/CapsuleSchedulePage'));
const CapsuleStatsPage = lazy(() => import('./pages/capsules/CapsuleStatsPage'));
const CapsuleDialoguePage = lazy(() => import('./pages/capsules/CapsuleDialoguePage'));
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
const CognitivePage = lazy(() => import('./pages/cognitive/CognitivePage'));
const FingerprintPage = lazy(() => import('./pages/cognitive/FingerprintPage'));
const BiasPage = lazy(() => import('./pages/cognitive/BiasPage'));
const CognitiveConflictPage = lazy(() => import('./pages/cognitive/CognitiveConflictPage'));
const DecisionAuditPage = lazy(() => import('./pages/cognitive/DecisionAuditPage'));
const FutureSimulationPage = lazy(() => import('./pages/cognitive/FutureSimulationPage'));
const CognitiveChallengePage = lazy(() => import('./pages/cognitive/CognitiveChallengePage'));
const CognitiveWeeklyReportPage = lazy(() => import('./pages/cognitive/CognitiveWeeklyReportPage'));
const BusinessPlanPage = lazy(() => import('./pages/BusinessPlanPage'));
const PaymentPage = lazy(() => import('./pages/PaymentPage'));
const PaymentSuccessPage = lazy(() => import('./pages/PaymentSuccessPage'));
const PaymentCancelPage = lazy(() => import('./pages/PaymentCancelPage'));
const TopupPage = lazy(() => import('./pages/TopupPage'));
const BillingPage = lazy(() => import('./pages/BillingPage'));
const EmergencePage = lazy(() => import('./pages/emergence/EmergencePage'));
const AssociatePage = lazy(() => import('./pages/emergence/AssociatePage'));
const CollisionPage = lazy(() => import('./pages/emergence/CollisionPage'));
const HybridPage = lazy(() => import('./pages/emergence/HybridPage'));
const CounterfactualPage = lazy(() => import('./pages/emergence/CounterfactualPage'));
const SourcePoolPage = lazy(() => import('./pages/emergence/SourcePoolPage'));
const CanvasPage = lazy(() => import('./pages/emergence/CanvasPage'));
const IdeaLibraryPage = lazy(() => import('./pages/emergence/IdeaLibraryPage'));
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

// Social Brain
const JianghuOverviewPage = lazy(() => import('./pages/jianghu/JianghuOverviewPage'));
const DailyReviewPage = lazy(() => import('./pages/jianghu/DailyReviewPage'));
const KnowledgeHealthPage = lazy(() => import('./pages/jianghu/KnowledgeHealthPage'));
const PracticeRecordsPage = lazy(() => import('./pages/jianghu/PracticeRecordsPage'));
const EvolutionTrackPage = lazy(() => import('./pages/jianghu/EvolutionTrackPage'));
const RelevanceCheckPage = lazy(() => import('./pages/jianghu/RelevanceCheckPage'));
const InvocationTrackPage = lazy(() => import('./pages/jianghu/InvocationTrackPage'));
const AiContextPage = lazy(() => import('./pages/socialBrain/AiContextPage'));
const CognitivePotentialPage = lazy(() => import('./pages/socialBrain/CognitivePotentialPage'));
const ExperimenterMindsetPage = lazy(() => import('./pages/shared/ExperimenterMindsetPage'));

// Embodied Cognition
const EmbodiedOverviewPage = lazy(() => import('./pages/embodiedCognition/EmbodiedOverviewPage'));
const DepthCheckPage = lazy(() => import('./pages/embodiedCognition/DepthCheckPage'));
const TrueEvolutionPage = lazy(() => import('./pages/embodiedCognition/TrueEvolutionPage'));
const MoodLocationPage = lazy(() => import('./pages/embodiedCognition/MoodLocationPage'));

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
            </Route>

            {/* Graph */}
            <Route path="graph" element={<GraphLayout />}>
              <Route index element={<GraphNetworkPage />} />
              <Route path="network" element={<GraphNetworkPage />} />
              <Route path="query" element={<GraphQueryPage />} />
              <Route path="path" element={<GraphPathPage />} />
              <Route path="report" element={<GraphReportPage />} />
              <Route path="bridges" element={<GraphBridgesPage />} />
              <Route path="tags" element={<GraphTagsPage />} />
              <Route path="timeline" element={<GraphTimelinePage />} />
            </Route>

            <Route path="search" element={<SearchPage />} />
            <Route path="community" element={<CommunityPage />} />
            <Route path="community/guide" element={<GuidePage />} />

            {/* Attention */}
            <Route path="attention" element={<ModuleLayout menuId="attention" />}>
              <Route index element={<AttentionDashboardPage />} />
              <Route path="dashboard" element={<AttentionDashboardPage />} />
              <Route path="deep-work" element={<AttentionDeepWorkPage />} />
              <Route path="budget" element={<AttentionBudgetPage />} />
              <Route path="guardian" element={<AttentionGuardianPage />} />
              <Route path="ration" element={<AttentionRationPage />} />
              <Route path="stats" element={<AttentionStatsPage />} />
            </Route>

            {/* Capsules */}
            <Route path="capsules" element={<ModuleLayout menuId="capsules" showOverview={false} />}>
              <Route index element={<Navigate to="my" replace />} />
              <Route path="my" element={<CapsuleListPage />} />
              <Route path="create" element={<CapsuleCreate />} />
              <Route path="dialogue" element={<CapsuleDialoguePage />} />
              <Route path="plaza" element={<CapsulePlazaPage />} />
              <Route path="schedule" element={<CapsuleSchedulePage />} />
              <Route path="stats" element={<CapsuleStatsPage />} />
              <Route path=":id" element={<CapsuleDetail />} />
            </Route>

            {/* Knowledge */}
            <Route path="knowledge" element={<ModuleLayout menuId="knowledge" showOverview={false} />}>
              <Route index element={<Navigate to="network" replace />} />
              <Route path="network" element={<NetworkKnowledgePage />} />
              <Route path="personal" element={<PersonalKnowledgePage />} />
              <Route path="verify" element={<VerificationCenterPage />} />
              <Route path="sources" element={<SourceTraceabilityPage />} />
              <Route path="counter" element={<CounterEvidenceWallPage />} />
              <Route path="credibility" element={<CredibilityMapPage />} />
              <Route path="timeliness" element={<TimelinessMonitorPage />} />
              <Route path="stats" element={<KnowledgeStatsPage />} />
              <Route path="create" element={<KnowledgeCreatePage />} />
              <Route path=":id" element={<KnowledgeDetail />} />
            </Route>

            {/* Pipeline */}
            <Route path="pipeline" element={<ModuleLayout menuId="pipeline" />}>
              <Route index element={<PipelineOverviewPage />} />
              <Route path="raw" element={<RawMaterialsPage />} />
              <Route path="cards" element={<CardsPage />} />
              <Route path="extract" element={<ExtractPage />} />
              <Route path="collision" element={<PipelineCollisionPage />} />
              <Route path="annotate" element={<AnnotatePage />} />
            </Route>

            {/* Social Brain */}
            <Route path="social-brain" element={<ModuleLayout menuId="social-brain" />}>
              <Route index element={<JianghuOverviewPage />} />
              <Route path="ai-context" element={<AiContextPage />} />
              <Route path="cognitive-potential" element={<CognitivePotentialPage />} />
              <Route path="experimenter" element={<ExperimenterMindsetPage />} />
              <Route path="daily-review" element={<DailyReviewPage />} />
              <Route path="knowledge-health" element={<KnowledgeHealthPage />} />
              <Route path="practice-records" element={<PracticeRecordsPage />} />
              <Route path="evolution-track" element={<EvolutionTrackPage />} />
              <Route path="relevance-check" element={<RelevanceCheckPage />} />
              <Route path="invocation-track" element={<InvocationTrackPage />} />
            </Route>

            {/* Embodied Cognition */}
            <Route path="embodied-cognition" element={<ModuleLayout menuId="embodied-cognition" />}>
              <Route index element={<EmbodiedOverviewPage />} />
              <Route path="depth-check" element={<DepthCheckPage />} />
              <Route path="true-evolution" element={<TrueEvolutionPage />} />
              <Route path="mood-location" element={<MoodLocationPage />} />
            </Route>

            {/* Emergence */}
            <Route path="emergence" element={<ModuleLayout menuId="emergence" />}>
              <Route index element={<EmergencePage />} />
              <Route path="sources" element={<SourcePoolPage />} />
              <Route path="associate" element={<AssociatePage />} />
              <Route path="collision" element={<CollisionPage />} />
              <Route path="hybrid" element={<HybridPage />} />
              <Route path="counterfactual" element={<CounterfactualPage />} />
              <Route path="canvas" element={<CanvasPage />} />
              <Route path="library" element={<IdeaLibraryPage />} />
            </Route>

            {/* Cognitive */}
            <Route path="cognitive" element={<ModuleLayout menuId="cognitive" />}>
              <Route index element={<CognitivePage />} />
              <Route path="fingerprint" element={<FingerprintPage />} />
              <Route path="bias" element={<BiasPage />} />
              <Route path="conflict" element={<CognitiveConflictPage />} />
              <Route path="audit" element={<DecisionAuditPage />} />
              <Route path="simulate" element={<FutureSimulationPage />} />
              <Route path="challenge" element={<CognitiveChallengePage />} />
              <Route path="weekly-report" element={<CognitiveWeeklyReportPage />} />
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

            <Route path="business-plan" element={<BusinessPlanPage />} />
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
