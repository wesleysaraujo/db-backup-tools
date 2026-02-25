import { config } from '../config/index.js';
import { StorageProvider } from './storage-providers/storage-provider.types.js';
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
        try
        {
            storageProviderInstance = new S3StorageProvider(config.storage.s3);
        } catch (err: any)
        {
            console.error('Falha ao instanciar S3Provider. Fallback para Local.', err.message);
            storageProviderInstance = new LocalStorageProvider(config.backupDir);
        }
    } else
    {
        storageProviderInstance = new LocalStorageProvider(config.backupDir);
    }

    return storageProviderInstance;
}
