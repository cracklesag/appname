import { Header } from '@/components/Header';
import { AddFieldForm } from '@/components/AddFieldForm';

export default function NewFieldPage() {
  return (
    <div>
      <Header title="Add field" subtitle="APP_NAME" backHref="/" />
      <AddFieldForm />
    </div>
  );
}
