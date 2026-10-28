// Development-only gallery of the SSI GLOBAL design system (route registered only when
// import.meta.env.DEV). Used to check every control in light/dark and with the keyboard.
import { useState } from 'react';
import { Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DatePicker,
  DateRangePicker,
  Drawer,
  Field,
  FilterSelect,
  Input,
  Menu,
  Modal,
  PageHeader,
  Select,
  SelectMenu,
  Slider,
  Switch,
  Table,
  Tabs,
  TimePicker,
  Tooltip,
} from '../components/ui';
import { ThemeMenu } from '../components/ThemeSwitcher';
import { useConfirm, useToast } from '../components/feedback';

const COUNTRIES = ['Australia', 'Canada', 'Germany', 'Ireland', 'New Zealand', 'United Kingdom', 'United States', 'India', 'Nepal', 'Sri Lanka'];

export default function DesignSystem() {
  const toast = useToast();
  const confirm = useConfirm();
  const [country, setCountry] = useState('');
  const [multi, setMulti] = useState<string[]>(['Canada']);
  const [filter, setFilter] = useState('');
  const [date, setDate] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [time, setTime] = useState('17:00');
  const [check, setCheck] = useState(true);
  const [sw, setSw] = useState(false);
  const [slider, setSlider] = useState(30000);
  const [tab, setTab] = useState<'a' | 'b'>('a');
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('bad-email');

  return (
    <div className="min-h-screen bg-canvas p-6 lg:p-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Design system" subtitle="Development gallery — not included in production builds." actions={<ThemeMenu />} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Selects" />
            <div className="grid gap-4 p-5">
              <Field label="Country (searchable)">
                <Select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
                  <option value="">Select country…</option>
                  {COUNTRIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Grouped">
                <Select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Grouped">
                  <optgroup label="Asia">
                    <option>India</option>
                    <option>Nepal</option>
                  </optgroup>
                  <optgroup label="Oceania">
                    <option>Australia</option>
                    <option>New Zealand</option>
                  </optgroup>
                </Select>
              </Field>
              <Field label="Multi-select">
                <SelectMenu multiple value={multi} onChange={setMulti} options={COUNTRIES.map((c) => ({ value: c, label: c }))} placeholder="Choose destinations" aria-label="Destinations" />
              </Field>
              <div className="flex gap-2">
                <FilterSelect label="All statuses" value={filter} onChange={setFilter} options={['Active', 'Onboarding', 'Inactive']} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Date & time" />
            <div className="grid gap-4 p-5">
              <Field label="Date (weekends disabled)">
                <DatePicker value={date} onChange={setDate} isDisabled={(d) => d.getDay() === 0 || d.getDay() === 6} aria-label="Date" />
              </Field>
              <Field label="Date range">
                <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
              </Field>
              <Field label="Time">
                <TimePicker value={time} onChange={setTime} aria-label="Time" />
              </Field>
              <Field label="Native-API input type=date (drop-in)">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Drop-in date" />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Controls" />
            <div className="grid gap-4 p-5">
              <Checkbox checked={check} onCheckedChange={setCheck} label="Remember me" description="Keeps you signed in on this device" />
              <div className="flex items-center gap-3">
                <Switch checked={sw} onCheckedChange={setSw} label="Weekly digest" />
                <span className="text-sm text-ink-soft">Weekly digest {sw ? 'on' : 'off'}</span>
              </div>
              <Slider value={slider} onValueChange={setSlider} min={2000} max={60000} step={1000} label="Max tuition" />
              <div className="flex flex-wrap gap-2">
                <Tooltip content="Helpful tooltip">
                  <Button variant="secondary">Hover me</Button>
                </Tooltip>
                <Button onClick={() => toast.success('Saved', 'Your changes were saved.')}>Success toast</Button>
                <Button variant="secondary" onClick={() => toast.error('Action not permitted', 'You do not have access.')}>
                  Error toast
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => (await confirm({ title: 'Delete record?', message: 'This cannot be undone.', danger: true, confirmLabel: 'Delete' })) && toast.info('Deleted')}
                >
                  Confirm dialog
                </Button>
              </div>
              <Tabs value={tab} onChange={setTab} tabs={[{ value: 'a', label: 'All', count: 3 }, { value: 'b', label: 'Active' }]} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Validation & alerts" />
            <div className="grid gap-4 p-5">
              <Field label="Name" required error={name ? undefined : 'Name is required.'}>
                <Input value={name} onChange={(e) => setName(e.target.value)} invalid={!name} />
              </Field>
              <Field label="Email" error={/^\S+@\S+\.\S+$/.test(email) ? undefined : 'Enter a valid email address.'}>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} invalid={!/^\S+@\S+\.\S+$/.test(email)} />
              </Field>
              <Alert tone="success" title="Saved">Profile updated.</Alert>
              <Alert tone="warning" title="Session expiring">You will be signed out soon.</Alert>
              <Alert tone="error">Permission denied.</Alert>
              <Alert tone="info">Read-only preview.</Alert>
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Table row menu (must not be clipped)" action={<Button size="sm" onClick={() => setModal(true)}>Open modal</Button>} />
            <div className="mt-3">
              <Table head={['Document', 'Status', '']}>
                <tr>
                  <td className="px-5 py-3 text-heading">passport.pdf</td>
                  <td className="px-5 py-3">
                    <Badge tone="amber" dot>Pending</Badge>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Menu
                      trigger={() => (
                        <button type="button" aria-label="Row actions" className="rounded-lg p-1.5 text-ink-mute hover:bg-canvas">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      )}
                      items={[
                        { label: 'Details', icon: Eye, onClick: () => setDrawer(true) },
                        { label: 'Edit', icon: Pencil, onClick: () => setModal(true) },
                        { label: 'Delete', icon: Trash2, onClick: () => toast.info('Delete'), danger: true },
                      ]}
                    />
                  </td>
                </tr>
              </Table>
            </div>
          </Card>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Edit record" dirty={!!name} footer={<Button onClick={() => setModal(false)}>Save</Button>}>
        <div className="grid gap-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type to make the form dirty" />
          </Field>
          <Field label="Country in modal">
            <Select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country in modal">
              <option value="">Select country…</option>
              {COUNTRIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date in modal">
            <DatePicker value={date} onChange={setDate} />
          </Field>
        </div>
      </Modal>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Details">
        <Field label="Time in drawer">
          <TimePicker value={time} onChange={setTime} />
        </Field>
      </Drawer>
    </div>
  );
}
