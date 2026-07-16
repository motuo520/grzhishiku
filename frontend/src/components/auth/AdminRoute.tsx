import { Navigate } from 'react-router-dom';
import { useAdminStore } from '../../store/adminStore';

export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const { admin } = useAdminStore();
  if (!admin) {
    return <Navigate to="/admin/login" replace />;
  }
  return <>{children}</>;
}
