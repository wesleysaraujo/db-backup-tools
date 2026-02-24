import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { ScheduleConfig } from '../types/index.js';

// Mock node-cron
const mockSchedule = jest.fn();
const mockValidate = jest.fn<(expression: string) => boolean>();
const mockStop = jest.fn();

jest.unstable_mockModule('node-cron', () => ({
  default: {
    schedule: mockSchedule,
    validate: mockValidate,
  },
}));

// Mock backup service
jest.unstable_mockModule('../services/backup.service.js', () => ({
  runBackup: jest.fn(),
}));

// Mock store
const mockStoreObj = {
  getSchedules: jest.fn<() => ScheduleConfig[]>(),
  updateSchedule: jest.fn(),
};

jest.unstable_mockModule('../store/index.js', () => ({
  store: mockStoreObj,
}));

const { startSchedule, stopSchedule, stopAll, loadAllSchedules, validateCron } =
  await import('../services/scheduler.service.js');

function makeSchedule(overrides: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return {
    id: 'sched-1',
    connectionId: 'conn-1',
    cronExpression: '0 0 * * *',
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('scheduler.service', () => {
  beforeEach(() => {
    mockSchedule.mockReturnValue({ stop: mockStop });
    mockValidate.mockReturnValue(true);
  });

  afterEach(() => {
    // Clean up active jobs between tests
    stopAll();
    jest.clearAllMocks();
  });

  describe('validateCron', () => {
    it('should return true for a valid cron expression', () => {
      mockValidate.mockReturnValue(true);
      expect(validateCron('0 0 * * *')).toBe(true);
    });

    it('should return false for an invalid cron expression', () => {
      mockValidate.mockReturnValue(false);
      expect(validateCron('invalid')).toBe(false);
    });
  });

  describe('startSchedule', () => {
    it('should not start a disabled schedule', () => {
      const schedule = makeSchedule({ enabled: false });
      startSchedule(schedule);
      expect(mockSchedule).not.toHaveBeenCalled();
    });

    it('should create a cron job for an enabled schedule', () => {
      const schedule = makeSchedule({ enabled: true });
      startSchedule(schedule);
      expect(mockSchedule).toHaveBeenCalledWith(
        schedule.cronExpression,
        expect.any(Function)
      );
    });

    it('should stop existing job before starting a new one for the same schedule', () => {
      const schedule = makeSchedule();
      startSchedule(schedule);
      startSchedule(schedule);
      // The first job should have been stopped
      expect(mockStop).toHaveBeenCalledTimes(1);
      // cron.schedule should have been called twice
      expect(mockSchedule).toHaveBeenCalledTimes(2);
    });
  });

  describe('stopSchedule', () => {
    it('should stop an active schedule', () => {
      const schedule = makeSchedule();
      startSchedule(schedule);
      stopSchedule('sched-1');
      expect(mockStop).toHaveBeenCalled();
    });

    it('should do nothing when stopping a non-existent schedule', () => {
      // Should not throw
      expect(() => stopSchedule('non-existent')).not.toThrow();
    });
  });

  describe('stopAll', () => {
    it('should stop all active schedules', () => {
      startSchedule(makeSchedule({ id: 's1' }));
      startSchedule(makeSchedule({ id: 's2' }));
      stopAll();
      expect(mockStop).toHaveBeenCalledTimes(2);
    });
  });

  describe('loadAllSchedules', () => {
    it('should load and start all enabled schedules from the store', () => {
      const schedules = [
        makeSchedule({ id: 's1', enabled: true }),
        makeSchedule({ id: 's2', enabled: false }),
        makeSchedule({ id: 's3', enabled: true }),
      ];
      mockStoreObj.getSchedules.mockReturnValue(schedules);

      loadAllSchedules();

      // Only enabled ones should trigger cron.schedule
      expect(mockSchedule).toHaveBeenCalledTimes(2);
    });

    it('should handle empty schedule list', () => {
      mockStoreObj.getSchedules.mockReturnValue([]);
      expect(() => loadAllSchedules()).not.toThrow();
      expect(mockSchedule).not.toHaveBeenCalled();
    });
  });
});
