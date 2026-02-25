import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { StorageProvider } from './storage-provider.types.js';

export class LocalStorageProvider implements StorageProvider
{
    constructor(private readonly backupDir: string)
    {
        if (!fs.existsSync(backupDir))
        {
            fs.mkdirSync(backupDir, { recursive: true });
        }
    }

    async upload(tempPath: string, filename: string): Promise<string>
    {
        const finalPath = path.join(this.backupDir, filename);

        // If temp file is on same disk we could rename, but copy/unlink is safer across partitions
        await fs.promises.copyFile(tempPath, finalPath);
        await fs.promises.unlink(tempPath);

        return finalPath;
    }

    async delete(filepath: string): Promise<boolean>
    {
        if (fs.existsSync(filepath))
        {
            try
            {
                await fs.promises.unlink(filepath);
                return true;
            } catch (err)
            {
                return false;
            }
        }
        return false;
    }

    async getDownloadStream(filepath: string): Promise<Readable>
    {
        if (!fs.existsSync(filepath))
        {
            throw new Error(`Arquivo não encontrado no disco: ${filepath}`);
        }
        return fs.createReadStream(filepath);
    }

    async downloadToTemp(filepath: string, tempPath: string): Promise<void>
    {
        if (!fs.existsSync(filepath))
        {
            throw new Error(`Arquivo não encontrado no disco: ${filepath}`);
        }
        // Local to local, just copy file
        await fs.promises.copyFile(filepath, tempPath);
    }
}
