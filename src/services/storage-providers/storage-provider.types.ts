import { Readable } from 'node:stream';

export interface StorageProvider
{
    /**
     * Upload (or move) a file from a temporary local path to its final destination.
     * After a successful upload, the temporary file should be removed.
     */
    upload(tempPath: string, filename: string): Promise<string>;

    /**
     * Remove a file from the storage.
     */
    delete(filepath: string): Promise<boolean>;

    /**
     * Get a readable stream for a file.
     * Useful for proxying downloads.
     */
    getDownloadStream(filepath: string): Promise<Readable>;

    /**
     * Download a file from storage to a temporary local path.
     * Useful before restoring from a remote backup.
     */
    downloadToTemp(filepath: string, tempPath: string): Promise<void>;
}
