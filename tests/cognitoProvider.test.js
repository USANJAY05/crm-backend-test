describe('Cognito provider configuration', () => {
  test('module declares the expected verifier contract', () => {
    const fs = require('fs');
    const source = fs.readFileSync(require.resolve('../src/auth/providers/cognito.js'), 'utf8');
    expect(source).toContain('CognitoJwtVerifier');
    expect(source).toContain('tokenUse: \'access\'');
    expect(source).toContain('tokenUse: \'id\'');
    expect(source).toContain('COGNITO_USER_POOL_ID');
    expect(source).toContain('COGNITO_CLIENT_ID');
  });
});


describe('Cognito CRM role provisioning', () => {
  test('uses Cognito groups for supported CRM roles', () => {
    const fs = require('fs');
    const source = fs.readFileSync(require.resolve('../src/auth/providers/cognito.js'), 'utf8');
    expect(source).toContain("SUPER_ADMIN: 'Super Admin'");
    expect(source).toContain("ORGANIZATION_ADMIN: 'Organization Admin'");
    expect(source).toContain("TEAM_MEMBER: 'Team Member'");
    expect(source).toContain('AdminAddUserToGroupCommand');
    expect(source).toContain('AdminRemoveUserFromGroupCommand');
    expect(source).toContain('AdminListGroupsForUserCommand');
    expect(source).not.toContain("Name: 'custom:role'");
  });

  test('resolves an existing Cognito user instead of silently returning null', () => {
    const fs = require('fs');
    const source = fs.readFileSync(require.resolve('../src/auth/providers/cognito.js'), 'utf8');
    expect(source).toContain('AdminGetUserCommand');
    expect(source).toContain('user = await getUser(normalizedEmail)');
    expect(source).toContain("getAttribute(resolved, 'sub')");
  });
});
