// src/services/HeliusWebhookManager.ts
import axios from 'axios';
import { Logger } from '../utils/Logger';

export interface WebhookConfig {
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: 'enhanced' | 'raw';
}

export class HeliusWebhookManager {
  private logger: Logger;
  private apiKey: string;

  constructor() {
    this.logger = Logger.getInstance();
    this.apiKey = process.env.HELIUS_API_KEY!;
  }

  async createDEXMonitoringWebhook(config: WebhookConfig): Promise<string> {
    try {
      const webhookData = {
        webhookURL: config.webhookURL,
        transactionTypes: config.transactionTypes,
        accountAddresses: config.accountAddresses,
        webhookType: config.webhookType,
        authHeader: process.env.WEBHOOK_AUTH_HEADER || undefined,
      };

      const response = await axios.post(
        `https://api.helius.xyz/v0/webhooks?api-key=${this.apiKey}`,
        webhookData
      );

      const webhookId = response.data.webhookID;
      this.logger.info(`✅ Created Helius webhook: ${webhookId}`);
      this.logger.info(`📡 Monitoring ${config.accountAddresses.length} DEX programs`);
      
      return webhookId;

    } catch (error) {
      this.logger.error('Failed to create Helius webhook:', error);
      throw error;
    }
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    try {
      await axios.delete(
        `https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${this.apiKey}`
      );
      this.logger.info(`🗑️ Deleted webhook: ${webhookId}`);
    } catch (error) {
      this.logger.error('Failed to delete webhook:', error);
      throw error;
    }
  }

  async listWebhooks(): Promise<any[]> {
    try {
      const response = await axios.get(
        `https://api.helius.xyz/v0/webhooks?api-key=${this.apiKey}`
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to list webhooks:', error);
      return [];
    }
  }

  // Программные адреса основных DEX на Solana
  static getDEXProgramAddresses(): string[] {
    return [
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter V6
      'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter V4  
      'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
      '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca V2
      'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1', // Orca V1
      '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
      'RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqXgEr', // Raydium V4
      '27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv', // Phoenix
    ];
  }
}