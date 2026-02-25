import { config } from '../config/index.js';
import type { StorageProvider } from './storage-providers/storage-provider.types.js';
import { LocalStorageProvider } from './storage-providers/local.provider.js';
import { S3StorageProvider } from './storage-providers/s3.provider.js';

let storageProviderInstance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider
{
    if (storageProviderInstance)
    {
        return storageProviderInstance;
    }

    if (config.storage.provider === 's3')
    {
        console.log(`[StorageService] STORAGE_PROVIDER=s3. Tentando instanciar S3StorageProvider...`);
        console.log(`[StorageService] S3 Config: Region=${config.storage.s3.region}, Bucket=${config.storage.s3.bucket}, Endpoint=${config.storage.s3.endpoint || 'AWS Padrão'}`);
        try
        {
            storageProviderInstance = new S3StorageProvider(config.storage.s3);
            console.log(`[StorageService] S3StorageProvider carregado com sucesso!`);
        } catch (err: any)
        {
            console.error('[StorageService] Falha ao instanciar S3Provider. Fallback para LocalStorageProvider:', err.message);
            storageProviderInstance = new LocalStorageProvider(config.backupDir);
        }
    } else
    {
        console.log(`[StorageService] STORAGE_PROVIDER=${config.storage.provider}. Carregando LocalStorageProvider.`);
        storageProviderInstance = new LocalStorageProvider(config.backupDir);
    }

    return storageProviderInstance;
}
