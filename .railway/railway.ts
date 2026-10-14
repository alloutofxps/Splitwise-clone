import { defineRailway, github, project, service, volume } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "Divvy";
export default defineRailway(() => {
  const data = volume("splitwise-clone-volume", { region: "sfo", sizeMB: 5000 });

  const Divvy = service("Divvy", {
    source: github("alloutofxps/Splitwise-clone", { branch: "main", checkSuites: false }),
    // `railway config migrate` left these two as comments; they carry over the
    // Dockerfile build from railway.json.
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    // `railway config migrate` dropped the restart policy from railway.json.
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "splitwise-clone" },
    // The SQLite database lives on this volume. `railway config migrate` left
    // it out, and applying without it would detach the volume from Divvy.
    volumeMounts: { "/data": data },
  });

  return project("diplomatic-reverence", {
    // Variables stay as they are in Railway. The CLI reads this option; the
    // `railway` package's types do not list it yet, so editors may flag it.
    variables: { managed: false },
    resources: [Divvy, data],
  });
});
