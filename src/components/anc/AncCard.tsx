import { AncProgram, useAnc, calculateWeeks } from '@/hooks/useAnc';
import { Patient } from '@/contexts/PatientContext';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

interface Props {
  program: AncProgram;
  patient?: Patient;
}

export function AncCard({ program, patient }: Props) {
  const { getVisitsForProgram } = useAnc();
  const visits = getVisitsForProgram(program.id);
  const week = program.lmp ? calculateWeeks(program.lmp) : null;

  return (
    <Card className="p-0 overflow-hidden border-2 border-orange-300 bg-orange-50">
      {/* Header */}
      <div className="p-4 bg-orange-100 border-b-2 border-orange-300 text-center">
        <div className="text-2xl font-bold tracking-wider">KHAMEC</div>
        <div className="text-xs uppercase tracking-widest">Antenatal Clinic</div>
        <div className="flex justify-between mt-2 text-xs">
          <span>REG. NO: <b>{program.anc_number}</b></span>
          <span>DATE: <b>{program.registration_date}</b></span>
        </div>
      </div>

      {/* Patient Info */}
      <div className="grid grid-cols-2 gap-0 border-b-2 border-orange-300">
        <div className="p-3 border-r-2 border-orange-300 text-sm space-y-1">
          <div><b>Name:</b> {patient ? `${patient.first_name} ${patient.last_name}` : '—'}</div>
          <div><b>Address:</b> {patient?.address || '—'}</div>
          <div><b>Age:</b> {patient?.date_of_birth || '—'}</div>
          <div><b>Religion:</b> {program.religion || '—'} <b className="ml-2">Tribe:</b> {program.tribe || '—'}</div>
          <div><b>Occupation:</b> {program.occupation || '—'}</div>
          <div><b>Husband's Occ:</b> {program.husband_occupation || '—'}</div>
          <div className="pt-2 border-t border-orange-200 mt-2">
            <b>LMP:</b> {program.lmp || '—'} <b className="ml-2">EDD:</b> {program.edd || '—'}
          </div>
          <div><b>Gravida:</b> {program.gravida ?? '—'} <b className="ml-2">Para:</b> {program.para ?? '—'}</div>
          <div><b>Weight:</b> {program.weight ?? '—'} <b className="ml-2">Height:</b> {program.height ?? '—'}</div>
          {week !== null && (
            <div className="pt-1">
              <Badge className="bg-pink-500 text-white">Week {week}</Badge>
              {program.high_risk && <Badge className="ml-2 bg-red-600 text-white">HIGH RISK</Badge>}
              <Badge variant="outline" className="ml-2 capitalize">{program.status}</Badge>
            </div>
          )}
        </div>
        <div className="p-3 text-sm space-y-2">
          <div className="font-semibold text-center border-b border-orange-300 pb-1">PREVIOUS PREGNANCIES</div>
          <div className="text-xs">
            {program.previous_pregnancies?.length
              ? program.previous_pregnancies.map((p: any, i: number) => (
                  <div key={i} className="border-b border-orange-200 py-1">
                    Year {p.year} · {p.duration} · {p.labour}
                  </div>
                ))
              : <div className="text-muted-foreground italic">No prior pregnancies recorded</div>}
          </div>
          <div className="pt-2"><b>Pelvic Assessment:</b><div className="text-xs mt-1">{program.pelvic_assessment || '—'}</div></div>
          <div><b>Special Considerations:</b><div className="text-xs mt-1">{program.special_considerations || '—'}</div></div>
          <div><b>Remarks:</b><div className="text-xs mt-1">{program.remarks || '—'}</div></div>
        </div>
      </div>

      {/* Visits table */}
      <div className="p-2 overflow-x-auto">
        <div className="text-xs font-semibold px-2 pb-1">FOLLOW-UP VISITS ({visits.length})</div>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-orange-100">
              {['Date','Week','Wt','BP','Urine','HB','Oedema','Fundus','Presentation','FH','Comment','Next','Sign'].map(h => (
                <th key={h} className="border border-orange-300 px-1 py-1 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visits.length === 0 && (
              <tr><td colSpan={13} className="text-center py-4 text-muted-foreground italic">No visits recorded</td></tr>
            )}
            {visits.map(v => (
              <tr key={v.id} className="hover:bg-orange-100">
                <td className="border border-orange-300 px-1 py-1">{v.visit_date}</td>
                <td className="border border-orange-300 px-1 py-1">{v.week_of_pregnancy ?? ''}</td>
                <td className="border border-orange-300 px-1 py-1">{v.weight ?? ''}</td>
                <td className="border border-orange-300 px-1 py-1">{v.blood_pressure ?? ''}</td>
                <td className="border border-orange-300 px-1 py-1">{v.urine ?? ''}</td>
                <td className="border border-orange-300 px-1 py-1">{v.hb ?? ''}</td>
                <td className="border border-orange-300 px-1 py-1">{v.oedema ?? ''}</td>
                <td className="border border-orange-300 px-1 py-1">{v.fundal_height ?? ''}</td>
                <td className="border border-orange-300 px-1 py-1">{v.presentation ?? ''}</td>
                <td className="border border-orange-300 px-1 py-1">{v.fetal_heart_rate ?? ''}</td>
                <td className="border border-orange-300 px-1 py-1">{v.comment ?? ''}</td>
                <td className="border border-orange-300 px-1 py-1">{v.next_visit ?? ''}</td>
                <td className="border border-orange-300 px-1 py-1 text-muted-foreground">✓</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {program.delivery_data && (
        <div className="p-3 bg-green-50 border-t-2 border-green-300 text-xs">
          <b>DELIVERY COMPLETED:</b> {program.delivery_data.delivery_date} · {program.delivery_data.mode} · {program.delivery_data.outcome} · Baby: {program.delivery_data.baby_sex}, {program.delivery_data.baby_weight}kg
        </div>
      )}
    </Card>
  );
}
