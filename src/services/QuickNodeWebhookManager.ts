// src/services/QuickNodeWebhookManager.ts - ИСПРАВЛЕНО
import { Logger } from '../utils/Logger';

interface QuickNodeStreamConfig {
  name: string;
  webhook_url: string;
  filters: {
    account_address?: string[];
    program_id?: string[];
  };
}

interface QuickNodeStreamResponse {
  id: string;
  name: string;
  webhook_url: string;
  status: string;
  filters: any;
}

export class QuickNodeWebhookManager {
  private logger: Logger;
  private httpUrl: string;
  private apiKey: string;

  constructor() {
    this.logger = Logger.getInstance();
    this.httpUrl = process.env.QUICKNODE_HTTP_URL!;
    this.apiKey = process.env.QUICKNODE_API_KEY!;
  }

  // Получает базовый URL для API (без /rpc)
  private getApiBaseUrl(): string {
    // Убираем слэш в конце и добавляем /api/v1
    const baseUrl = this.httpUrl.replace(/\/$/, '');
    // QuickNode API endpoint для streams
    return baseUrl.replace(/\/[^\/]*$/, '') + '/api/v1';
  }

  async createDEXMonitoringStream(webhookUrl: string): Promise<string> {
    try {
      // Временно отключаем streams - сразу переходим к polling
    this.logger.info('💡 Using polling mode (streams disabled)');
    return 'polling-mode';

      // DEX программы на Solana
      const dexPrograms = [
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium
        '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca
        'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
      ];

      const streamConfig: QuickNodeStreamConfig = {
        name: 'smart-money-dex-monitor',
        webhook_url: webhookUrl,
        filters: {
          program_id: dexPrograms
        }
      };

      // QuickNode Streams API endpoint - ИСПРАВЛЕНО
      const apiUrl = `${this.getApiBaseUrl()}/streams`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'Solana-Tracker-Bot/1.0'
        },
        body: JSON.stringify(streamConfig)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      const streamData = await response.json() as QuickNodeStreamResponse;
      
      this.logger.info(`✅ QuickNode stream created: ${streamData.id}`);
      this.logger.info(`📡 Monitoring ${dexPrograms.length} DEX programs`);
      
      return streamData.id;

    } catch (error) {
      this.logger.error('❌ Error creating QuickNode stream:', error);
      
      // Fallback: работаем без streams (polling mode)
      this.logger.info('💡 Fallback: Starting polling mode without streams');
      return 'polling-mode';
    }
  }

  async deleteStream(streamId: string): Promise<void> {
    try {
      if (streamId === 'polling-mode') return;

      this.logger.info(`🗑️ Deleting QuickNode stream: ${streamId}`);

      const response = await fetch(`${this.getApiBaseUrl()}/streams/${streamId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'Solana-Tracker-Bot/1.0'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      this.logger.info(`✅ QuickNode stream deleted: ${streamId}`);

    } catch (error) {
      this.logger.error('❌ Error deleting QuickNode stream:', error);
    }
  }

  async listStreams(): Promise<QuickNodeStreamResponse[]> {
    try {
      const response = await fetch(`${this.getApiBaseUrl()}/streams`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'Solana-Tracker-Bot/1.0'
        }
      });

      if (!response.ok) {
        return [];
      }

      const streams = await response.json() as QuickNodeStreamResponse[];
      this.logger.info(`📋 Found ${streams.length} existing QuickNode streams`);
      
      return streams;

    } catch (error) {
      this.logger.error('❌ Error listing QuickNode streams:', error);
      return [];
    }
  }

  // Получает информацию о токене через QuickNode
  async getTokenMetadata(tokenAddress: string): Promise<{
    name?: string;
    symbol?: string;
    description?: string;
  }> {
    try {
      // Используем стандартный Solana RPC для получения метаданных
      const response = await fetch(this.httpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [
            tokenAddress,
            {
              encoding: 'jsonParsed'
            }
          ]
        })
      });

      if (!response.ok) {
        return {};
      }

      const data = await response.json() as any;
      
      if (data.result?.value?.data?.parsed?.info) {
        const tokenInfo = data.result.value.data.parsed.info;
        return {
          name: tokenInfo.name,
          symbol: tokenInfo.symbol,
          description: tokenInfo.description
        };
      }

      return {};

    } catch (error) {
      this.logger.error(`Error getting token metadata for ${tokenAddress}:`, error);
      return {};
    }
  }

  // Получает количество держателей токена
  async getTokenHolders(tokenAddress: string): Promise<number> {
    try {
      // Получаем все токен-аккаунты для этого токена
      const response = await fetch(this.httpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getProgramAccounts',
          params: [
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
            {
              encoding: 'jsonParsed',
              filters: [
                {
                  dataSize: 165 // Размер токен-аккаунта
                },
                {
                  memcmp: {
                    offset: 0,
                    bytes: tokenAddress
                  }
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        return 0;
      }

      const data = await response.json() as any;
      
      if (data.result && Array.isArray(data.result)) {
        // Фильтруем только аккаунты с балансом > 0
        const holdersWithBalance = data.result.filter((account: any) => {
          const tokenAmount = account.account?.data?.parsed?.info?.tokenAmount;
          return tokenAmount && parseFloat(tokenAmount.amount) > 0;
        });
        
        return holdersWithBalance.length;
      }

      return 0;

    } catch (error) {
      this.logger.error(`Error getting token holders for ${tokenAddress}:`, error);
      return 0;
    }
  }

  // Проверяет статус stream
  async getStreamStatus(streamId: string): Promise<{
    isActive: boolean;
    status?: string;
  }> {
    try {
      if (streamId === 'polling-mode') {
        return { isActive: true, status: 'polling' };
      }

      const response = await fetch(`${this.getApiBaseUrl()}/streams/${streamId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'Solana-Tracker-Bot/1.0'
        }
      });

      if (!response.ok) {
        return { isActive: false };
      }

      const streamData = await response.json() as QuickNodeStreamResponse;
      
      return {
        isActive: streamData.status === 'active',
        status: streamData.status
      };

    } catch (error) {
      this.logger.error(`Error getting stream status for ${streamId}:`, error);
      return { isActive: false };
    }
  }

  // Очищает все старые streams
  async cleanupOldStreams(): Promise<void> {
    try {
      this.logger.info('🧹 Cleaning up old QuickNode streams...');
      
      const streams = await this.listStreams();
      
      for (const stream of streams) {
        try {
          await this.deleteStream(stream.id);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Пауза между удалениями
        } catch (error) {
          this.logger.warn(`Failed to delete stream ${stream.id}:`, error);
        }
      }
      
      this.logger.info(`✅ Cleaned up ${streams.length} old streams`);

    } catch (error) {
      this.logger.error('❌ Error during stream cleanup:', error);
    }
  }
}