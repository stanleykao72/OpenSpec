/**
 * Waiver system for gate escape hatch.
 *
 * A .waiver.yaml file allows skipping gates (e.g., hotfix profile).
 * Required fields: reason, approver, expiry (YYYY-MM-DD), ticket.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import * as yaml from 'yaml';

export interface WaiverData {
  reason: string;
  approver: string;
  expiry: string;
  ticket: string;
}

export interface WaiverValidation {
  valid: boolean;
  error?: string;
}

export interface WaiverEntry {
  changeName: string;
  changeDir: string;
  waiver: WaiverData;
  expired: boolean;
}

const WAIVER_FILENAME = '.waiver.yaml';
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Load a waiver file from a change directory.
 * Returns null if no waiver file exists.
 */
export function loadWaiver(changeDir: string): WaiverData | null {
  const waiverPath = path.join(changeDir, WAIVER_FILENAME);
  if (!existsSync(waiverPath)) {
    return null;
  }

  const content = readFileSync(waiverPath, 'utf-8');
  const parsed = yaml.parse(content);

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  return parsed as WaiverData;
}

/**
 * Validate a waiver has all required fields and hasn't expired.
 */
export function validateWaiver(waiver: WaiverData): WaiverValidation {
  if (!waiver.reason || typeof waiver.reason !== 'string' || waiver.reason.trim() === '') {
    return { valid: false, error: 'Missing required field: reason' };
  }
  if (!waiver.approver || typeof waiver.approver !== 'string' || waiver.approver.trim() === '') {
    return { valid: false, error: 'Missing required field: approver' };
  }
  if (!waiver.ticket || typeof waiver.ticket !== 'string' || waiver.ticket.trim() === '') {
    return { valid: false, error: 'Missing required field: ticket' };
  }
  if (!waiver.expiry || typeof waiver.expiry !== 'string') {
    return { valid: false, error: 'Missing required field: expiry' };
  }
  if (!DATE_REGEX.test(waiver.expiry)) {
    return { valid: false, error: 'expiry must be in YYYY-MM-DD format' };
  }

  // Check expiry
  const today = new Date().toISOString().split('T')[0];
  if (waiver.expiry < today) {
    return { valid: false, error: 'Waiver expired, please renew or complete gate remediation' };
  }

  return { valid: true };
}

/**
 * Scan all changes in a directory for active waivers.
 */
export function listWaivers(changesDir: string): WaiverEntry[] {
  const entries: WaiverEntry[] = [];
  const today = new Date().toISOString().split('T')[0];

  if (!existsSync(changesDir)) {
    return entries;
  }

  const dirs = readdirSync(changesDir, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory() || dir.name.startsWith('.') || dir.name === 'archive') {
      continue;
    }

    const changeDir = path.join(changesDir, dir.name);
    const waiver = loadWaiver(changeDir);
    if (waiver) {
      entries.push({
        changeName: dir.name,
        changeDir,
        waiver,
        expired: Boolean(waiver.expiry && waiver.expiry < today),
      });
    }
  }

  return entries;
}
