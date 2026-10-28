import { useMemo } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, Card, CardHeader, PageHeader, Table } from '../../components/ui';
import { StatusDonut, TopCountries, TrendChart } from '../../components/charts';
import { useToast } from '../../components/feedback';
import { useChartColors } from '../../theme/theme';
import { useLookup, useStore } from '../../store/store';
import { APP_STATUSES } from '../../data/types';
import { appStatusColor, fullName, money } from '../../lib/utils';

export default function Reports() {
  const { db } = useStore();
  const lk = useLookup();
  const toast = useToast();
  const c = useChartColors();

  const funnel = APP_STATUSES.map((s) => ({ status: s.replace('Pending Assessment', 'Assessment').replace(' Offer', ''), full: s, count: db.applications.filter((a) => a.status === s).length }));

  const partnerRows = useMemo(
    () =>
      db.partners.map((p) => {
        const apps = db.applications.filter((a) => a.partnerId === p.id);
        const granted = apps.filter((a) => a.status === 'Visa Granted').length;
        const refused = apps.filter((a) => a.status === 'Visa Refused').length;
        const pay = db.payments.filter((x) => x.partnerId === p.id);
        return {
          name: p.name,
          students: db.students.filter((s) => s.partnerId === p.id).length,
          apps: apps.length,
          offers: apps.filter((a) => ['Conditional Offer', 'Unconditional Offer', 'Visa Lodged', 'Visa Granted', 'Visa Refused'].includes(a.status)).length,
          granted,
          success: granted + refused ? Math.round((granted / (granted + refused)) * 100) : 0,
          revenue: pay.reduce((s, x) => s + x.paid, 0),
        };
      }),
    [db],
  );

  const exportCsv = () => {
    const header = ['Reference', 'Student', 'Partner', 'University', 'Course', 'Country', 'Intake', 'Status', 'Applied'];
    const lines = db.applications.map((a) => {
      const u = lk.university.get(a.universityId);
      return [a.ref, fullName(lk.student.get(a.studentId)), lk.partner.get(a.partnerId)?.name, u?.name, lk.course.get(a.courseId)?.name, u?.country, a.intake, a.status, a.appliedAt.slice(0, 10)]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',');
    });
    const url = URL.createObjectURL(new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const el = document.createElement('a');
    el.href = url;
    el.download = `ssi-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    el.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported', `${db.applications.length} applications downloaded as CSV.`);
  };

  return (
    <>
      <PageHeader title="Reports" subtitle="Performance insights across the SSI GLOBAL network." actions={<Button icon={Download} onClick={exportCsv}>Export CSV</Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="12-month trend" subtitle="Applications, offers and visas" />
          <div className="p-3"><TrendChart apps={db.applications} months={12} height={260} /></div>
        </Card>
        <Card>
          <CardHeader title="Pipeline funnel" subtitle="Current applications by stage" />
          <div className="h-[276px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid horizontal={false} stroke={c.grid} />
                <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: c.tickMute }} allowDecimals={false} />
                <YAxis type="category" dataKey="status" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: c.tick }} width={110} />
                <Tooltip cursor={{ fill: c.cursor }} contentStyle={{ borderRadius: 12, ...c.tooltip }} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={18} animationDuration={1000}>
                  {funnel.map((f) => <Cell key={f.full} fill={appStatusColor[f.full]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Status distribution" />
          <div className="p-5"><StatusDonut apps={db.applications} /></div>
        </Card>
        <Card>
          <CardHeader title="Destinations" />
          <div className="p-5"><TopCountries apps={db.applications} universities={db.universities} /></div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Partner scorecard" subtitle="Visa success = granted ÷ decided" action={<FileBarChart className="h-5 w-5 text-ink-mute" />} />
          <div className="mt-3">
            <Table head={['Partner', 'Students', 'Applications', 'Offers', 'Visas granted', 'Visa success', 'Collected']}>
              {partnerRows.map((r) => (
                <tr key={r.name} className="hover:bg-brand-50/30">
                  <td className="px-5 py-3.5 font-semibold text-heading">{r.name}</td>
                  <td className="px-5 py-3.5 text-ink-soft">{r.students}</td>
                  <td className="px-5 py-3.5 text-ink-soft">{r.apps}</td>
                  <td className="px-5 py-3.5 text-ink-soft">{r.offers}</td>
                  <td className="px-5 py-3.5 text-ink-soft">{r.granted}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-canvas">
                        <div className="h-full rounded-full bg-gradient-to-r from-brand to-rust" style={{ width: `${r.success}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-heading">{r.success}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 font-semibold text-heading">{money(r.revenue)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      </div>
    </>
  );
}
