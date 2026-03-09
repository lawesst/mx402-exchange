import { ApiDetailScreen } from '../../../components/screens/api-detail-screen';

export default function ApiDetailPage({ params }: { params: { slug: string } }) {
  return <ApiDetailScreen slug={params.slug} />;
}
