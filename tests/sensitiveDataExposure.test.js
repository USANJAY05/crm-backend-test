const fs = require("fs");
const path = require("path");

describe("sensitive data exposure guards", () => {
  test("cloud project repository uses safe serialization for public reads", () => {
    const source = fs.readFileSync(path.join(__dirname, "../src/db/repositories/organizationRepository.js"), "utf8");
    expect(source).toContain("return toApiCloudProject(data || null);");
    expect(source).toContain("return toApiCloudProject(data);");
    expect(source).toContain("map(toApiCloudProject)");
    expect(source).toContain("getCloudProjectWithCredentials");
  });
});
