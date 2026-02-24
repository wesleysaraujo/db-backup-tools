import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

let mockApiKey = '';

jest.unstable_mockModule('../config/index.js', () => ({
  config: {
    get apiKey() {
      return mockApiKey;
    },
    port: 3777,
    backupDir: '/tmp/backups',
    dataDir: '/tmp/data',
    dbPath: '/tmp/data/db.sqlite',
    encryptionKey: 'test-key',
  },
}));

const { authMiddleware } = await import('../middleware/auth.middleware.js');

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('authMiddleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    mockApiKey = '';
    next = jest.fn() as unknown as NextFunction;
  });

  it('bloqueia tudo quando apiKey nao esta configurada', () => {
    const req = mockReq();
    const res = mockRes();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Unauthorized: API_KEY not configured on server',
    });
  });

  it('permite com Authorization: Bearer correto', () => {
    mockApiKey = 'my-secret-key';
    const req = mockReq({ authorization: 'Bearer my-secret-key' });
    const res = mockRes();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('permite com X-API-Key correto', () => {
    mockApiKey = 'my-secret-key';
    const req = mockReq({ 'x-api-key': 'my-secret-key' });
    const res = mockRes();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('retorna 401 sem header de auth', () => {
    mockApiKey = 'my-secret-key';
    const req = mockReq();
    const res = mockRes();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Unauthorized: invalid or missing API key',
    });
  });

  it('retorna 401 com token errado', () => {
    mockApiKey = 'my-secret-key';
    const req = mockReq({ authorization: 'Bearer wrong-key' });
    const res = mockRes();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('retorna 401 com Authorization sem Bearer prefix', () => {
    mockApiKey = 'my-secret-key';
    const req = mockReq({ authorization: 'my-secret-key' });
    const res = mockRes();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('authMiddleware integrado com createApp', () => {
  it('health check acessivel sem auth', async () => {
    mockApiKey = 'test-key-123';

    // Mock all dependencies needed by createApp
    jest.unstable_mockModule('../store/index.js', () => ({
      store: {
        getConnections: jest.fn().mockReturnValue([]),
        getConnection: jest.fn(),
        addConnection: jest.fn(),
        updateConnection: jest.fn(),
        deleteConnection: jest.fn(),
        getBackups: jest.fn().mockReturnValue([]),
        getBackup: jest.fn(),
        addBackup: jest.fn(),
        updateBackup: jest.fn(),
        getSchedules: jest.fn().mockReturnValue([]),
        getSchedule: jest.fn(),
        addSchedule: jest.fn(),
        updateSchedule: jest.fn(),
        deleteSchedule: jest.fn(),
      },
    }));

    jest.unstable_mockModule('../drivers/driver-registry.js', () => ({
      getDriver: jest.fn(),
      getSupportedTypes: jest.fn().mockReturnValue(['mysql']),
    }));

    jest.unstable_mockModule('../services/scheduler.service.js', () => ({
      loadAllSchedules: jest.fn(),
      startSchedule: jest.fn(),
      stopSchedule: jest.fn(),
      stopAll: jest.fn(),
      validateCron: jest.fn().mockReturnValue(true),
    }));

    const supertest = await import('supertest');
    const { createApp } = await import('../server.js');
    const app = createApp();

    const healthRes = await supertest.default(app).get('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');

    const protectedRes = await supertest.default(app).get('/api/connections');
    expect(protectedRes.status).toBe(401);

    const authedRes = await supertest.default(app)
      .get('/api/connections')
      .set('Authorization', 'Bearer test-key-123');
    expect(authedRes.status).toBe(200);
  });
});
