import { describe, expect, it } from "vitest";

import {
  buildAlertCriteriaInsert,
  buildJarvisAnalysisInsert,
  computeNextVersion,
} from "@/lib/jarvis-run";
import type { AlertCriteriaExtract } from "@/lib/jarvis-parser";
import type { JarvisSections } from "@/lib/jarvis-parser";

describe("computeNextVersion", () => {
  it("returns 1 when no versions exist yet", () => {
    expect(computeNextVersion([])).toBe(1);
  });

  it("returns one more than the current max version", () => {
    expect(computeNextVersion([1])).toBe(2);
    expect(computeNextVersion([1, 2, 3])).toBe(4);
  });

  it("is robust to out-of-order input", () => {
    expect(computeNextVersion([3, 1, 2])).toBe(4);
  });
});

const SECTIONS: JarvisSections = {
  thesis: "Thesis text",
  stressTest: "Stress test text",
  tradePlan: "Trade plan text",
  riskAwareness: "Risk awareness text",
  exitDiscipline: "Exit discipline text",
};

describe("buildJarvisAnalysisInsert", () => {
  it("maps each of the 4 narrative columns from the 5 parsed sections, folding riskAwareness into exit_json ahead of exitDiscipline", () => {
    const insert = buildJarvisAnalysisInsert({
      stockId: "stock-1",
      version: 3,
      extractionOk: true,
      sections: SECTIONS,
      rawResponse: "raw text",
      modelId: "anthropic/claude-sonnet-4.5",
      inputContext: { price: 100 },
    });

    expect(insert.stock_id).toBe("stock-1");
    expect(insert.version).toBe(3);
    expect(insert.is_latest).toBe(true);
    expect(insert.extraction_ok).toBe(true);
    expect(insert.thesis_json).toEqual({ narrative: "Thesis text" });
    expect(insert.stress_test_json).toEqual({ narrative: "Stress test text" });
    expect(insert.trade_plan_json).toEqual({ narrative: "Trade plan text" });
    expect(insert.exit_json).toEqual({
      narrative: "Risk awareness text\n\nExit discipline text",
    });
    expect(insert.raw_llm_response).toBe("raw text");
    expect(insert.model_id).toBe("anthropic/claude-sonnet-4.5");
    expect(insert.input_context_json).toEqual({ price: 100 });
  });

  it("does not lose the exit narrative when riskAwareness is empty (missing header)", () => {
    const insert = buildJarvisAnalysisInsert({
      stockId: "stock-1",
      version: 1,
      extractionOk: false,
      sections: { ...SECTIONS, riskAwareness: "" },
      rawResponse: "raw text",
      modelId: "model-x",
      inputContext: null,
    });

    expect(insert.exit_json).toEqual({ narrative: "Exit discipline text" });
    expect(insert.extraction_ok).toBe(false);
  });
});

const EXTRACT: AlertCriteriaExtract = {
  entry_zone: { low: 100, high: 110 },
  stop_loss: 90,
  trim_targets: [
    { price: 130, pct_of_position: 0.5 },
    { price: 150, pct_of_position: 0.5 },
  ],
  time_exit_date: "2026-12-31",
  reassessment_date: "2026-09-15",
  earnings_date: null,
  invalidation_condition: "Thesis breaks if X happens",
  catalyst: "Earnings beat",
  verdict: "proceed",
  position_size_note: "Standard size",
};

describe("buildAlertCriteriaInsert", () => {
  it("maps extraction.data fields onto the alert_criteria insert shape", () => {
    const insert = buildAlertCriteriaInsert({
      stockId: "stock-1",
      jarvisAnalysisId: "analysis-1",
      data: EXTRACT,
    });

    expect(insert).toEqual({
      stock_id: "stock-1",
      jarvis_analysis_id: "analysis-1",
      is_active: true,
      entry_low: 100,
      entry_high: 110,
      stop_loss: 90,
      trim_targets: EXTRACT.trim_targets,
      time_exit_date: "2026-12-31",
      reassessment_date: "2026-09-15",
      earnings_date: null,
      invalidation_text: "Thesis breaks if X happens",
    });
  });
});
