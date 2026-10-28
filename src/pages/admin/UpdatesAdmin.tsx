import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BellRing, Eye, EyeOff, Megaphone, MoreVertical, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, Field, Input, Menu, Modal, PageHeader, SearchInput, Select, Tabs, Textarea } from '../../components/ui';
import { useConfirm, useToast } from '../../components/feedback';
import { UpdateCard } from '../../components/UpdateCard';
import { useStore } from '../../store/store';
import { UPDATE_CATEGORIES, type Announcement, type DerivedUpdateStatus, type Priority, type UpdateCategory } from '../../data/types';
import { cn, fromDateInput, matches, toDateInput, updateStatus } from '../../lib/utils';

type TabKey = 'all' | DerivedUpdateStatus;

export default function UpdatesAdmin() {
  const { db, actions } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>('all');
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const [draftFilters, setDraftFilters] = useState({ status: '', priority: '', category: '', from: '', to: '' });
  const [filters, setFilters] = useState(draftFilters);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement>();

  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing(undefined);
      setFormOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const withStatus = db.announcements.map((a) => ({ a, st: updateStatus(a) }));
  const count = (s: DerivedUpdateStatus) => withStatus.filter((x) => x.st === s).length;

  const rows = useMemo(
    () =>
      withStatus
        .filter(({ st }) => tab === 'all' || st === tab)
        .filter(({ a }) => matches(q, a.title, a.body, a.category))
        .filter(({ st }) => !filters.status || st === filters.status)
        .filter(({ a }) => !filters.priority || a.priority === filters.priority)
        .filter(({ a }) => !filters.category || a.category === filters.category)
        .filter(({ a }) => !filters.from || a.publishAt >= fromDateInput(filters.from, 0))
        .filter(({ a }) => !filters.to || a.publishAt <= fromDateInput(filters.to, 23))
        .sort((x, y) => y.a.createdAt.localeCompare(x.a.createdAt)),
    [withStatus, tab, q, filters],
  );

  const remove = async (a: Announcement) => {
    if (await confirm({ title: 'Delete announcement?', message: `“${a.title}” will be removed for all partners.`, confirmLabel: 'Delete', danger: true })) {
      actions.removeAnnouncement(a.id);
      toast.success('Announcement deleted');
    }
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <>
      <PageHeader
        title="Important Updates"
        subtitle="Stay informed with the latest announcements and updates."
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Search updates…" className="w-full sm:w-64" />
            <Button variant="secondary" icon={SlidersHorizontal} onClick={() => setShowFilters((s) => !s)}>
              Filter{activeFilterCount ? ` (${activeFilterCount})` : ''}
            </Button>
            <Button icon={Plus} onClick={() => { setEditing(undefined); setFormOpen(true); }}>
              New Update
            </Button>
          </>
        }
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'All Updates', count: db.announcements.length },
          { value: 'Active', label: 'Active', count: count('Active') },
          { value: 'Scheduled', label: 'Scheduled', count: count('Scheduled') },
          { value: 'Expired', label: 'Expired', count: count('Expired') },
          { value: 'Draft', label: 'Drafts', count: count('Draft') },
        ]}
      />
      <div className={cn('grid gap-6', showFilters && 'xl:grid-cols-[1fr_300px]')}>
        <Card className="px-5">
          {rows.length === 0 ? (
            <EmptyState icon={Megaphone} title="No updates here" description="Create an announcement to keep partners informed." action={<Button icon={Plus} onClick={() => setFormOpen(true)}>New Update</Button>} />
          ) : (
            <div className="divide-y divide-line">
              {rows.map(({ a, st }) => (
                <UpdateCard
                  key={a.id}
                  a={a}
                  actions={
                    <Menu
                      trigger={() => (
                        <button type="button" aria-label="Update actions" className="rounded-lg p-1 text-ink-mute hover:bg-canvas hover:text-heading">
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      )}
                      items={[
                        { label: 'Edit', icon: Pencil, onClick: () => { setEditing(a); setFormOpen(true); } },
                        a.published
                          ? { label: 'Unpublish (to draft)', icon: EyeOff, onClick: () => { actions.setAnnouncementPublished(a.id, false); toast.info('Moved to drafts', a.title); } }
                          : { label: st === 'Draft' ? 'Publish now' : 'Publish', icon: Eye, onClick: () => { actions.setAnnouncementPublished(a.id, true); toast.success('Published', 'Partners can now see this update.'); } },
                        { label: 'Delete', icon: Trash2, onClick: () => remove(a), danger: true },
                      ]}
                    />
                  }
                />
              ))}
            </div>
          )}
        </Card>
        {showFilters && (
          <div className="space-y-6">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-[15px] font-semibold text-heading">Filters</h3>
                <button
                  type="button"
                  className="text-xs font-semibold text-rust hover:underline"
                  onClick={() => {
                    const cleared = { status: '', priority: '', category: '', from: '', to: '' };
                    setDraftFilters(cleared);
                    setFilters(cleared);
                  }}
                >
                  Clear all
                </button>
              </div>
              <div className="space-y-4">
                <Field label="Status">
                  <Select value={draftFilters.status} onChange={(e) => setDraftFilters({ ...draftFilters, status: e.target.value })}>
                    <option value="">All Status</option>
                    {['Active', 'Scheduled', 'Expired', 'Draft'].map((s) => <option key={s}>{s}</option>)}
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select value={draftFilters.priority} onChange={(e) => setDraftFilters({ ...draftFilters, priority: e.target.value })}>
                    <option value="">All Priorities</option>
                    {['High', 'Medium', 'Normal'].map((s) => <option key={s}>{s}</option>)}
                  </Select>
                </Field>
                <Field label="Category">
                  <Select value={draftFilters.category} onChange={(e) => setDraftFilters({ ...draftFilters, category: e.target.value })}>
                    <option value="">All Categories</option>
                    {UPDATE_CATEGORIES.map((s) => <option key={s}>{s}</option>)}
                  </Select>
                </Field>
                <Field label="Date range">
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="date" aria-label="From" value={draftFilters.from} onChange={(e) => setDraftFilters({ ...draftFilters, from: e.target.value })} className="px-2.5 text-xs" />
                    <Input type="date" aria-label="To" value={draftFilters.to} onChange={(e) => setDraftFilters({ ...draftFilters, to: e.target.value })} className="px-2.5 text-xs" />
                  </div>
                </Field>
                <Button className="w-full" onClick={() => { setFilters(draftFilters); toast.info('Filters applied'); }}>
                  Apply Filters
                </Button>
              </div>
            </Card>
            <Card className="p-6 text-center">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-brand-50">
                <BellRing className="h-9 w-9 animate-[float_3s_ease-in-out_infinite] text-brand" />
              </div>
              <h4 className="font-display font-semibold text-heading">Stay Informed</h4>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">Important updates and announcements help your partner network stay aligned and informed about critical information.</p>
            </Card>
          </div>
        )}
      </div>
      <UpdateForm open={formOpen} onClose={() => setFormOpen(false)} update={editing} />
    </>
  );
}

function UpdateForm({ open, onClose, update }: { open: boolean; onClose: () => void; update?: Announcement }) {
  const { db, actions } = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<UpdateCategory>('Admissions');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [body, setBody] = useState('');
  const [publishAt, setPublishAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [audienceAll, setAudienceAll] = useState(true);
  const [audience, setAudience] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setTitle(update?.title ?? '');
    setCategory(update?.category ?? 'Admissions');
    setPriority(update?.priority ?? 'Normal');
    setBody(update?.body ?? '');
    setPublishAt(toDateInput(update?.publishAt ?? new Date().toISOString()));
    setExpiresAt(toDateInput(update?.expiresAt ?? new Date(Date.now() + 30 * 86400000).toISOString()));
    setAudienceAll(!update || update.audience === 'all');
    setAudience(update && update.audience !== 'all' ? update.audience : []);
    setErrors({});
  }, [open, update]);

  const save = (published: boolean) => {
    const e: Record<string, string> = {};
    if (title.trim().length < 5) e.title = 'Title must be at least 5 characters.';
    if (body.trim().length < 10) e.body = 'Add a short description.';
    if (!publishAt) e.publishAt = 'Required.';
    if (!expiresAt) e.expiresAt = 'Required.';
    else if (expiresAt < publishAt) e.expiresAt = 'Must be after publish date.';
    if (!audienceAll && !audience.length) e.audience = 'Select at least one partner.';
    setErrors(e);
    if (Object.keys(e).length) return toast.error('Please fix the highlighted fields');
    const today = toDateInput(new Date().toISOString());
    actions.saveAnnouncement({
      id: update?.id,
      title: title.trim(),
      category,
      priority,
      body: body.trim(),
      published,
      // Publishing "today" goes live immediately; future dates are scheduled.
      publishAt: publishAt === today ? new Date(Date.now() - 60000).toISOString() : fromDateInput(publishAt),
      expiresAt: fromDateInput(expiresAt, 23),
      audience: audienceAll ? 'all' : audience,
    });
    toast.success(
      published ? (publishAt > today ? 'Update scheduled' : 'Update published') : 'Draft saved',
      published ? (publishAt > today ? `Goes live on ${publishAt}.` : 'Now visible in the Client Portal.') : undefined,
    );
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={update ? 'Edit update' : 'New update'}
      subtitle="Announcements appear in partners’ Client Portal once published."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={() => save(false)}>Save as draft</Button>
          <Button icon={Megaphone} onClick={() => save(true)}>Publish</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required error={errors.title} className="sm:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} invalid={!!errors.title} placeholder="e.g. Canada January Intake Now Open" autoFocus />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as UpdateCategory)}>
            {UPDATE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Priority">
          <div className="grid grid-cols-3 gap-2">
            {(['High', 'Medium', 'Normal'] as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={cn('h-11 rounded-xl border text-sm font-semibold transition', priority === p ? 'border-rust bg-brand-50 text-rust' : 'border-line text-ink-soft hover:border-navy-200')}
              >
                {p}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Message" required error={errors.body} className="sm:col-span-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} invalid={!!errors.body} rows={4} placeholder="Write the announcement for partners…" />
        </Field>
        <Field label="Publish date" required error={errors.publishAt} hint="Future dates are scheduled automatically.">
          <Input type="date" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
        </Field>
        <Field label="Expiry date" required error={errors.expiresAt}>
          <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} invalid={!!errors.expiresAt} />
        </Field>
        <Field label="Audience" error={errors.audience} className="sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAudienceAll(true)} className={cn('rounded-full border px-3.5 py-1.5 text-sm font-semibold', audienceAll ? 'border-navy bg-navy text-white dark:border-navy-500 dark:bg-navy-500' : 'border-line text-ink-soft')}>
              All partners
            </button>
            <button type="button" onClick={() => setAudienceAll(false)} className={cn('rounded-full border px-3.5 py-1.5 text-sm font-semibold', !audienceAll ? 'border-navy bg-navy text-white dark:border-navy-500 dark:bg-navy-500' : 'border-line text-ink-soft')}>
              Selected partners
            </button>
          </div>
          {!audienceAll && (
            <div className="mt-3 flex flex-wrap gap-2">
              {db.partners.map((p) => {
                const on = audience.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setAudience(on ? audience.filter((x) => x !== p.id) : [...audience, p.id])}
                    className={cn('rounded-xl border px-3 py-1.5 text-sm font-medium transition', on ? 'border-rust bg-brand-50 text-rust' : 'border-line text-ink-soft hover:border-navy-200')}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          )}
        </Field>
      </div>
    </Modal>
  );
}
