import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { defaultConfig } from "../config/loader.js";
import { CoordinatorIntakeService } from "../coordinator/intake.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ProjectRegistry } from "../registries/project.js";
import {
  GitHubRepositoryProvisionService,
  type GitHubRepositoryProvisionClient,
  type GitHubRepositoryProvisionClientRepo,
} from "./repository-provisioner.js";

class RecordingRepositoryClient implements GitHubRepositoryProvisionClient {
  created: Array<{
    owner: string;
    name: string;
    ownerType: "user" | "org";
    private: boolean;
    description?: string;
    autoInit?: boolean;
  }> = [];

  async createRepository(input: {
    owner: string;
    name: string;
    ownerType: "user" | "org";
    private: boolean;
    description?: string;
    autoInit?: boolean;
  }): Promise<GitHubRepositoryProvisionClientRepo> {
    this.created.push(input);
    return {
      owner: input.owner,
      repo: input.name,
      fullName: `${input.owner}/${input.name}`,
      url: `https://github.com/${input.owner}/${input.name}`,
      private: input.private,
      defaultBranch: input.autoInit === false ? "" : "main",
      createdAt: "2026-05-25T10:00:00.000Z",
    };
  }
}

describe("GitHubRepositoryProvisionService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-github-repo-"));
    await initWorkspace({ root: dir, organizationName: "GitHub Repo Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function prepareProject() {
    const intake = await new CoordinatorIntakeService(dir, {
      config: defaultConfig("agency"),
    }).process({
      clientName: "Pizzeria Aurora",
      message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
      source: "owner_chat",
    });
    return intake.project;
  }

  it("creates a private repository by default and links project memory", async () => {
    const project = await prepareProject();
    const githubClient = new RecordingRepositoryClient();

    const result = await new GitHubRepositoryProvisionService(dir, {
      config: defaultConfig("agency"),
      githubClient,
    }).provision({
      projectSlug: project.slug,
      owner: "emanueledenaro",
      autoInit: true,
    });

    expect(result.status).toBe("created");
    expect(result.repository).toMatchObject({
      owner: "emanueledenaro",
      repo: "pizzeria-aurora-booking-website",
      private: true,
    });
    expect(githubClient.created[0]).toMatchObject({
      owner: "emanueledenaro",
      name: "pizzeria-aurora-booking-website",
      ownerType: "user",
      private: true,
      autoInit: true,
    });

    const updatedProject = await new ProjectRegistry(dir).get(project.slug);
    expect(updatedProject?.repository).toBe(
      "https://github.com/emanueledenaro/pizzeria-aurora-booking-website",
    );

    const reports = await new ArtifactStore(dir).list({ type: "repository-provisioning-report" });
    expect(reports).toHaveLength(1);
    const written = await new ArtifactStore(dir).read(reports[0]!.id);
    expect(written?.body).toContain("Repository Provisioning Report");
    expect(written?.body).toContain("Visibility: private");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.repository_provision.created");
  });

  it("requests approval instead of creating a repository when policy disables it", async () => {
    const project = await prepareProject();
    const config = defaultConfig("agency");
    config.autonomy.create_repositories = false;
    const githubClient = new RecordingRepositoryClient();

    const result = await new GitHubRepositoryProvisionService(dir, {
      config,
      githubClient,
    }).provision({
      projectSlug: project.slug,
      owner: "emanueledenaro",
      repo: "pizzeria-aurora",
    });

    expect(result.status).toBe("blocked");
    expect(githubClient.created).toHaveLength(0);
    expect(result.approval?.action).toBe("create_repositories");

    const approvals = await new ApprovalRegistry(dir).listPending();
    expect(approvals.map((approval) => approval.action)).toContain("create_repositories");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.repository_provision.blocked");
  });

  it("requires explicit approval before creating a public repository", async () => {
    const project = await prepareProject();
    const githubClient = new RecordingRepositoryClient();

    const result = await new GitHubRepositoryProvisionService(dir, {
      config: defaultConfig("agency"),
      githubClient,
    }).provision({
      projectSlug: project.slug,
      owner: "emanueledenaro",
      repo: "public-client-site",
      private: false,
    });

    expect(result.status).toBe("blocked");
    expect(githubClient.created).toHaveLength(0);
    expect(result.policy.reason).toContain("public repository visibility");
    expect(result.policy.required_gates).toContain("public_repository_visibility");
  });
});
