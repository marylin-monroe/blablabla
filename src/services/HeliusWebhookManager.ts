// src/services/HeliusWebhookManager.ts - ПОЛНАЯ РЕАЛИЗАЦИЯ
import { Logger } from '../utils/Logger';

interface WebhookConfig {
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: 'enhanced' | 'discord';
}

interface WebhookResponse {
  webhookID: string;
  webhook: string;
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: string;
}

export class HeliusWebhookManager {
  private logger: Logger;
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.logger = Logger.getInstance();
    this.apiKey = process.env.HELIUS_API_KEY!;
    this.baseUrl = 'https://api.helius.xyz/v0/webhooks';
  }

  async createDEXMonitoringWebhook(config: WebhookConfig): Promise<string> {
    try {
      this.logger.info('🔗 Creating Helius DEX monitoring webhook...');

      const response = await fetch(`${this.baseUrl}?api-key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhookURL: config.webhookURL,
          transactionTypes: config.transactionTypes,
          accountAddresses: config.accountAddresses,
          webhookType: config.webhookType,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      const webhookData = await response.json() as WebhookResponse;
      
      this.logger.info(`✅ Webhook created successfully: ${webhookData.webhookID}`);
      this.logger.info(`📡 Monitoring ${webhookData.accountAddresses.length} DEX programs`);
      
      return webhookData.webhookID;

    } catch (error) {
      this.logger.error('❌ Error creating webhook:', error);
      throw error;
    }
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    try {
      this.logger.info(`🗑️ Deleting webhook: ${webhookId}`);

      const response = await fetch(`${this.baseUrl}/${webhookId}?api-key=${this.apiKey}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      this.logger.info(`✅ Webhook deleted successfully: ${webhookId}`);

    } catch (error) {
      this.logger.error('❌ Error deleting webhook:', error);
      throw error;
    }
  }

  async listWebhooks(): Promise<WebhookResponse[]> {
    try {
      const response = await fetch(`${this.baseUrl}?api-key=${this.apiKey}`, {
        method: 'GET',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      const webhooks = await response.json() as WebhookResponse[];
      this.logger.info(`📋 Found ${webhooks.length} existing webhooks`);
      
      return webhooks;

    } catch (error) {
      this.logger.error('❌ Error listing webhooks:', error);
      return [];
    }
  }

  async updateWebhook(webhookId: string, config: Partial<WebhookConfig>): Promise<void> {
    try {
      this.logger.info(`🔄 Updating webhook: ${webhookId}`);

      const response = await fetch(`${this.baseUrl}/${webhookId}?api-key=${this.apiKey}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      this.logger.info(`✅ Webhook updated successfully: ${webhookId}`);

    } catch (error) {
      this.logger.error('❌ Error updating webhook:', error);
      throw error;
    }
  }

  // Получает адреса программ основных DEX на Solana
  static getDEXProgramAddresses(): string[] {
    return [
      // Jupiter
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
      
      // Raydium
      '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      '61111111111111111111111111111111111111111111',
      
      // Orca
      '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
      'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
      
      // Serum
      '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
      
      // Meteora
      'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
      
      // Lifinity
      'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S',
      
      // Saber
      'SSwpkEEWHvPc9a8gL5ASt9OzOF9aFkyLXmJSmW2mYGy',
      
      // Aldrin
      'AMM55ShdkoGRB5jVYPjWzwekxtFMq5cD6mDLBp5bH9A',
      
      // Cropper
      'CTMAxxk34HjKWxQ3QLZBB1hVqddA2dNhAKJrDvV2qHVD',
      
      // Phoenix
      'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLfrbCtXnKYgZP',
      
      // OpenBook
      'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb'
    ];
  }

  // Создает webhook специально для Token Name Alert мониторинга
  async createTokenNameAlertWebhook(webhookURL: string): Promise<string> {
    try {
      this.logger.info('🔗 Creating Token Name Alert webhook...');

      // Мониторим программы создания токенов
      const tokenCreationPrograms = [
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Account Program
      ];

      const response = await fetch(`${this.baseUrl}?api-key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhookURL,
          transactionTypes: ['UNKNOWN'], // Все типы транзакций
          accountAddresses: tokenCreationPrograms,
          webhookType: 'enhanced',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      const webhookData = await response.json() as WebhookResponse;
      
      this.logger.info(`✅ Token Name Alert webhook created: ${webhookData.webhookID}`);
      
      return webhookData.webhookID;

    } catch (error) {
      this.logger.error('❌ Error creating Token Name Alert webhook:', error);
      throw error;
    }
  }

  // Получает информацию о токене для анализа держателей
  async getTokenHolders(tokenAddress: string): Promise<number> {
    try {
      const response = await fetch(`https://api.helius.xyz/v0/tokens/${tokenAddress}/holders?api-key=${this.apiKey}`);
      
      if (!response.ok) {
        return 0;
      }

      const data = await response.json() as any;
      return data.total || 0;

    } catch (error) {
      this.logger.error(`Error getting token holders for ${tokenAddress}:`, error);
      return 0;
    }
  }

  // Получает метаданные токена для анализа имени
  async getTokenMetadata(tokenAddress: string): Promise<{
    name?: string;
    symbol?: string;
    description?: string;
  }> {
    try {
      const response = await fetch(`https://api.helius.xyz/v0/tokens/metadata?api-key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mintAccounts: [tokenAddress]
        })
      });

      if (!response.ok) {
        return {};
      }

      const data = await response.json() as any[];
      
      if (data && data.length > 0) {
        const tokenData = data[0];
        return {
          name: tokenData.onChainMetadata?.metadata?.name,
          symbol: tokenData.onChainMetadata?.metadata?.symbol,
          description: tokenData.onChainMetadata?.metadata?.description
        };
      }

      return {};

    } catch (error) {
      this.logger.error(`Error getting token metadata for ${tokenAddress}:`, error);
      return {};
    }
  }

  // Проверяет статус webhook
  async getWebhookStatus(webhookId: string): Promise<{
    isActive: boolean;
    lastPing?: Date;
    totalDeliveries?: number;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/${webhookId}?api-key=${this.apiKey}`, {
        method: 'GET',
      });

      if (!response.ok) {
        return { isActive: false };
      }

      const webhookData = await response.json() as any;
      
      return {
        isActive: true,
        lastPing: webhookData.lastPing ? new Date(webhookData.lastPing) : undefined,
        totalDeliveries: webhookData.totalDeliveries || 0
      };

    } catch (error) {
      this.logger.error(`Error getting webhook status for ${webhookId}:`, error);
      return { isActive: false };
    }
  }

  // Очищает все старые webhooks
  async cleanupOldWebhooks(): Promise<void> {
    try {
      this.logger.info('🧹 Cleaning up old webhooks...');
      
      const webhooks = await this.listWebhooks();
      
      for (const webhook of webhooks) {
        try {
          await this.deleteWebhook(webhook.webhookID);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Пауза между удалениями
        } catch (error) {
          this.logger.warn(`Failed to delete webhook ${webhook.webhookID}:`, error);
        }
      }
      
      this.logger.info(`✅ Cleaned up ${webhooks.length} old webhooks`);

    } catch (error) {
      this.logger.error('❌ Error during webhook cleanup:', error);
    }
  }
}