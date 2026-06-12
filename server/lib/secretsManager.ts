export interface SecretManager {
  getSecret(key: string): Promise<string | undefined>;
  getRequiredSecret(key: string): Promise<string>;
}

export class EnvSecretManager implements SecretManager {
  async getSecret(key: string): Promise<string | undefined> {
    return process.env[key];
  }

  async getRequiredSecret(key: string): Promise<string> {
    const secret = process.env[key];
    if (!secret) {
      throw new Error(`Required secret '${key}' not found in environment variables.`);
    }
    return secret;
  }
}

// TODO: Add other implementations (e.g., VaultSecretManager, AwsSecretManager) later.
