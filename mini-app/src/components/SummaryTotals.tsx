/**
 * SummaryTotals — the running total block (CALC-01/CALC-02). Renders a
 * finished `NutrientTotal` the API computed; the only numeric operation
 * permitted in this file is `Math.round` at render time, mirroring the rule
 * `src/bot/formatting/correction-card.ts`'s `formatTotalsBlock` already
 * established (raw floats from the math layer, rounding at the display
 * edge only, so a future weekly sum never compounds rounding error).
 *
 * The five labels/units below are copied verbatim from that file's
 * `NUTRIENT_META` table so the Mini App and the retired chat card never
 * disagree on a label.
 */
import { copy } from '../copy';
import type { NutrientTotal } from '../types';

type NutrientKey = 'kcal' | 'proteinG' | 'fatG' | 'carbsG' | 'sugarG';

// Copied verbatim from src/bot/formatting/correction-card.ts's NUTRIENT_META.
const NUTRIENT_META: ReadonlyArray<{ key: NutrientKey; label: string; unit: string }> = [
  { key: 'kcal', label: `Калории`, unit: `ккал` },
  { key: 'proteinG', label: `Белки`, unit: `г` },
  { key: 'fatG', label: `Жиры`, unit: `г` },
  { key: 'carbsG', label: `Углеводы`, unit: `г` },
  { key: 'sugarG', label: `Сахар`, unit: `г` },
];

interface SummaryTotalsProps {
  total: NutrientTotal;
  contributingCount: number;
  saved: boolean;
}

export function SummaryTotals({ total, contributingCount, saved }: SummaryTotalsProps) {
  return (
    <div>
      {saved ? null : <p className="text-caption text-hint">{copy.previewPrefix}</p>}
      {NUTRIENT_META.map(({ key, label, unit }) => {
        const value = total[key];
        const missing = total.missingCount[key];
        const isKcal = key === 'kcal';
        const lineClass = isKcal ? 'text-heading' : 'text-caption';

        let text: string;
        if (value === null) {
          text = `${label}: ${copy.noData}`;
        } else {
          const rounded = Math.round(value);
          text = missing === 0
            ? `${label}: ${rounded} ${unit}`
            : `${label}: ${copy.partialTotal(`${rounded} ${unit}`, missing, contributingCount)}`;
        }

        return (
          <p key={key} className={lineClass}>
            {text}
          </p>
        );
      })}
      {saved ? null : <p className="text-caption text-hint">{copy.notSavedMarker}</p>}
    </div>
  );
}
