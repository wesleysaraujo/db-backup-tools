import fs from 'node:fs';
import { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { StorageProvider } from './storage-provider.types.js';

export interface S3StorageConfig
{
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    endpoint?: string;
}

export class S3StorageProvider implements StorageProvider
{
    private client: S3Client;
    private bucket: string;

    constructor(config: S3StorageConfig)
    {
        this.bucket = config.bucket;

        // Configura o client apenas se todas as credenciais base estiverem presentes
        if (!config.accessKeyId || !config.secretAccessKey || !config.region || !config.bucket)
        {
            throw new Error('Configuração S3 incompleta. Verifique o arquivo .env (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET).');
        }

        const s3Config: any = {
            region: config.region,
            forcePathStyle: !!config.endpoint,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        };
        if (config.endpoint)
        {
            s3Config.endpoint = config.endpoint;
        }

        this.client = new S3Client(s3Config);
    }

    async upload(tempPath: string, filename: string): Promise<string>
    {
        const fileStream = fs.createReadStream(tempPath);

        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: filename,
            Body: fileStream,
        });

        await this.client.send(command);

        // Remove local file
        if (fs.existsSync(tempPath))
        {
            await fs.promises.unlink(tempPath);
        }

        // Retorna a chave do objeto no S3 como filepath virtual
        return filename;
    }

    async delete(filepath: string): Promise<boolean>
    {
        try
        {
            const command = new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: filepath,
            });
            await this.client.send(command);
            return true;
        } catch (err)
        {
            return false;
        }
    }

    async getDownloadStream(filepath: string): Promise<Readable>
    {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: filepath,
        });

        const response = await this.client.send(command);
        if (!response.Body)
        {
            throw new Error(`Arquivo não encontrado no S3: ${filepath}`);
        }

        return response.Body as unknown as Readable;
    }

    async downloadToTemp(filepath: string, tempPath: string): Promise<void>
    {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: filepath,
        });

        const response = await this.client.send(command);
        if (!response.Body)
        {
            throw new Error(`Arquivo não encontrado no S3: ${filepath}`);
        }

        const outputStream = fs.createWriteStream(tempPath);
        const inputStream = response.Body as NodeJS.ReadableStream;

        return new Promise((resolve, reject) =>
        {
            inputStream.pipe(outputStream)
                .on('finish', resolve)
                .on('error', reject);

            outputStream.on('error', reject);
        });
    }
}
