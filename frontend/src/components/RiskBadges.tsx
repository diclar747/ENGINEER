import React from 'react';
import { AlertTriangle, Activity, Zap, Heart, ShieldAlert, Pill, AlertOctagon } from 'lucide-react';
import { stripAsterisks } from '../utils/textFormat';

interface RiskBadgesProps {
  conditions: string[] | string;
  allergies?: string;
  contraindicatedMeds?: string;
}

export const RiskBadges: React.FC<RiskBadgesProps> = ({
  conditions,
  allergies,
  contraindicatedMeds,
}) => {
  let condList: string[] = [];
  try {
    if (Array.isArray(conditions)) {
      condList = conditions;
    } else if (typeof conditions === 'string' && conditions.trim()) {
      condList = JSON.parse(conditions);
    }
  } catch {
    if (typeof conditions === 'string' && conditions.trim()) {
      condList = [conditions];
    }
  }

  const getConditionIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('diabet')) return <Activity className="w-4 h-4 text-amber-600 dark:text-amber-400" />;
    if (lower.includes('epilep')) return <Zap className="w-4 h-4 text-purple-400" />;
    if (lower.includes('hipert') || lower.includes('presion') || lower.includes('corazon')) return <Heart className="w-4 h-4 text-rose-600 dark:text-rose-400" />;
    if (lower.includes('marcapaso') || lower.includes('cardio')) return <Activity className="w-4 h-4 text-teal-600 dark:text-teal-400" />;
    return <AlertTriangle className="w-4 h-4 text-teal-600 dark:text-teal-300" />;
  };

  const cleanAllergies = stripAsterisks(allergies);
  const cleanMeds = stripAsterisks(contraindicatedMeds);

  return (
    <div className="space-y-3.5">
      {/* Visual Condition Badges */}
      {condList.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {condList.map((cond: string, idx: number) => {
            const cleanCond = stripAsterisks(cond);
            return (
              <div
                key={idx}
                className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-panel border border-line/80 shadow-sm"
              >
                <div className="p-1 rounded-lg bg-muted/80">
                  {getConditionIcon(cleanCond)}
                </div>
                <span className="text-xs sm:text-sm font-bold text-fg">{cleanCond}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-fg-muted italic">Sin condiciones médicas críticas registradas.</p>
      )}

      {/* Severe Allergies Warning Box */}
      {cleanAllergies && cleanAllergies !== 'Ninguna declarada' && cleanAllergies !== 'Ninguna' && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-red-950/80 via-rose-950/60 to-red-950/40 border border-rose-500/50 shadow-lg shadow-rose-950/50">
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-[11px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-300 flex items-center gap-1.5">
                <span>⚠️ ALERGIAS SEVERAS / RIESGO DE ANAFILAXIA</span>
              </h4>
              <p className="mt-1 text-sm sm:text-base font-bold text-fg leading-relaxed">
                {cleanAllergies}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Contraindicated Medications Warning Box */}
      {cleanMeds && cleanMeds !== 'Ninguno declarado' && cleanMeds !== 'Ninguno' && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/80 via-orange-950/60 to-amber-950/40 border border-amber-500/50 shadow-lg shadow-amber-950/50">
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
              <Pill className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-[11px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-300 flex items-center gap-1.5">
                <span>⛔ MEDICAMENTOS CONTRAINDICADOS</span>
              </h4>
              <p className="mt-1 text-xs sm:text-sm font-bold text-amber-100 leading-relaxed">
                {cleanMeds}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
