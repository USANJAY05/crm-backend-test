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
