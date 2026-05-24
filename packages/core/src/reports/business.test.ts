import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { CoordinatorIntakeService } from "../coordinator/intake.js";
import { initWorkspace } from "../init/initializer.js";
import { ArtifactStore } from "../artifacts/store.js";
import { BusinessReportService } from "./business.js";

describe("BusinessReportService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-reports-"));
    await initWorkspace({ root: dir, organizationName: "Report Test Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("generates executive and operating reports from real registries", async () => {
    await new CoordinatorIntakeService(dir, { config: defaultConfig("agency") }).process({
      clientName: "Pizzeria Aurora",
      message:
        "Ho parlato con una pizzeria: vuole sito con prenotazioni, logo, posizione e contenuti.",
      expectedValue: 4_500,
    });

    const report = await new BusinessReportService(dir, {
      config: defaultConfig("agency"),
    }).generate();

    expect(report.metrics.clients_total).toBe(1);
    expect(report.metrics.projects_total).toBe(1);
    expect(report.metrics.opportunities_total).toBe(1);
    expect(report.metrics.pipeline_value).toBe(4_500);
    expect(report.metrics.approvals_pending).toBeGreaterThanOrEqual(3);
    expect(report.executive_report.type).toBe("executive-report");
    expect(report.business_operating_report.type).toBe("business-operating-report");

    const artifacts = await new ArtifactStore(dir).list();
    expect(artifacts.map((artifact) => artifact.type)).toEqual(
      expect.arrayContaining(["executive-report", "business-operating-report"]),
    );
  });
});
