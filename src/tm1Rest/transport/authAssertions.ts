// src/tm1Rest/transport/authAssertions.ts
// Compile-time proof that the `Tm1Auth` discriminated union makes invalid auth
// states unrepresentable. These are pure TYPE aliases — they emit no runtime
// code (esbuild strips them; nothing imports this module) but `tsc -p ./`
// (npm run typecheck) evaluates every conditional below. If any invalid combo
// ever became assignable to `Tm1Config` again, the corresponding `AssertTrue`
// argument would flip to `false` and fail the constraint → typecheck breaks.
import type { Tm1Config } from './types';

/** Fails to instantiate unless T is exactly `true`. */
type AssertTrue<T extends true> = T;

/** `true` when Candidate is NOT assignable to Tm1Config (i.e. correctly rejected). */
type Rejected<Candidate> = Candidate extends Tm1Config ? false : true;
/** `true` when Candidate IS assignable to Tm1Config (i.e. correctly accepted). */
type Accepted<Candidate> = Candidate extends Tm1Config ? true : false;

type Base = { serverUrl: string; username: string; password: string; rejectUnauthorized: boolean };

// ── Invalid states MUST be rejected ────────────────────────────────────────
// CAM without a namespace — the exact hole this task closes (was: opaque 401).
type _CamNoNamespace = AssertTrue<Rejected<Base & { authType: 'CAM' }>>;
// v12-basic without a v12 config.
type _V12BasicNoConfig = AssertTrue<Rejected<Base & { authType: 'v12-basic'; version: 'v12' }>>;

// Integrated authentication is v11 — not representable with v12.
type _IntegratedV12 = AssertTrue<Rejected<Base & { authType: 'integrated'; version: 'v12' }>>;
// Browser login on v12 only against PA SaaS.
type _BrowserV12NotSaas = AssertTrue<
  Rejected<Base & { authType: 'browser'; version: 'v12'; v12: { instance: string; database: string; authMode: 'basic-s2s'; tm1User: string } }>
>;
type _BrowserV12NoConfig = AssertTrue<Rejected<Base & { authType: 'browser'; version: 'v12' }>>;

// ── Valid states MUST be accepted ──────────────────────────────────────────
type _BasicOk    = AssertTrue<Accepted<Base & { authType: 'Basic' }>>;
type _BasicBare  = AssertTrue<Accepted<Base>>; // authType omitted ≡ Basic
type _CamOk      = AssertTrue<Accepted<Base & { authType: 'CAM'; camNamespace: string }>>;
type _IntegratedOk = AssertTrue<Accepted<Base & { authType: 'integrated' }>>;
type _V12BasicOk = AssertTrue<
  Accepted<Base & { authType: 'v12-basic'; version: 'v12'; v12: { instance: string; database: string; authMode: 'basic-s2s'; tm1User: string } }>
>;
type _BrowserPawOk  = AssertTrue<Accepted<Base & { authType: 'browser' }>>;
type _BrowserSaasOk = AssertTrue<
  Accepted<Base & { authType: 'browser'; version: 'v12'; v12: { instance: string; database: string; authMode: 'saas'; tm1User: string } }>
>;

// Reference the aliases so tooling never prunes them and the assertions always
// participate in the type program.
export type _Tm1AuthAssertions = [
  _CamNoNamespace, _V12BasicNoConfig, _IntegratedV12, _BrowserV12NotSaas, _BrowserV12NoConfig,
  _BasicOk, _BasicBare, _CamOk, _IntegratedOk, _V12BasicOk, _BrowserPawOk, _BrowserSaasOk,
];
