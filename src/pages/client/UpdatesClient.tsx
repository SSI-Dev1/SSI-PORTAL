import { useMemo, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { Card, EmptyState, FilterSelect, PageHeader, SearchInput, Tabs } from '../../components/ui';
import { UpdateCard } from '../../components/UpdateCard';
import { useScoped } from '../../store/store';
import { UPDATE_CATEGORIES } from '../../data/types';
import { matches, updateStatus } from '../../lib/utils';

/** Partners only ever see published announcements that are live or expired. */
export default function UpdatesClient() {
  const scoped = useScoped();
  const [tab, setTab] = useState<'Active' | 'Expired'>('Active');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');

  const visible = scoped.announcements.filter((a) => {
    const st = updateStatus(a);
    return st === 'Active' || st === 'Expired';
  });
  const rows = useMemo(
    () =>
      visible
        .filter((a) => updateStatus(a) === tab)
        .filter((a) => matches(q, a.title, a.body))
        .filter((a) => !category || a.category === category)
        .filter((a) => !priority || a.priority === priority)
        .sort((a, b) => {
          const p = { High: 0, Medium: 1, Normal: 2 };
          return p[a.priority] - p[b.priority] || b.publishAt.localeCompare(a.publishAt);
        }),
    [visible, tab, q, category, priority],
  );

  return (
    <>
      <PageHeader title="Important Updates" subtitle="Announcements from SSI GLOBAL for your team." />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'Active', label: 'Current', count: visible.filter((a) => updateStatus(a) === 'Active').length },
          { value: 'Expired', label: 'Archive', count: visible.filter((a) => updateStatus(a) === 'Expired').length },
        ]}
      />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <SearchInput value={q} onChange={setQ} placeholder="Search updates…" className="sm:w-80" />
        <FilterSelect label="All categories" value={category} onChange={setCategory} options={[...UPDATE_CATEGORIES]} />
        <FilterSelect label="All priorities" value={priority} onChange={setPriority} options={['High', 'Medium', 'Normal']} />
      </div>
      <Card className="px-5">
        {rows.length === 0 ? (
          <EmptyState icon={Megaphone} title="No updates" description="New announcements from SSI GLOBAL will appear here." />
        ) : (
          <div className="divide-y divide-line">
            {rows.map((a) => (
              <UpdateCard key={a.id} a={a} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
