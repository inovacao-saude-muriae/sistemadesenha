import { isSupabaseAdminConfigured, supabaseAdmin } from "./supabase-admin";
import { isSupabaseConfigured, supabase } from "./supabase";

export function isInvalidApiKeyError(error) {
  return /invalid api key/i.test(String(error?.message || error || ""));
}

export function getQueueDb() {
  if (isSupabaseAdminConfigured && supabaseAdmin) return supabaseAdmin;
  if (isSupabaseConfigured && supabase) return supabase;
  return null;
}

export function getQueueDbClients() {
  const clients = [];
  if (isSupabaseAdminConfigured && supabaseAdmin) clients.push(supabaseAdmin);
  if (isSupabaseConfigured && supabase && supabase !== clients[0]) {
    clients.push(supabase);
  }
  return clients;
}

export function normalizeCallType(type) {
  const isPriority = type === "preferential" || type === "preferencial";
  return {
    sequenceType: isPriority ? "preferencial" : "normal",
    callType: isPriority ? "preferential" : "normal",
  };
}

export function formatNumberString(num, type) {
  const prefix =
    type === "preferencial" || type === "preferential" ? "P" : "N";
  if (Number(num) >= 1000) return "1000";
  return `${prefix}${String(Number(num) || 0).padStart(3, "0")}`;
}

function nextValue(current) {
  const value = Number(current) || 0;
  return value >= 1000 ? 1 : value + 1;
}

async function incrementViaRpc(db, sector, sequenceType) {
  try {
    const { data, error } = await db.rpc("call_queue", {
      p_sector_id: sector,
      p_call_type: sequenceType,
    });
    if (error || data == null) return null;
    const result = typeof data === "object" ? data : { number: data };
    const number = Number(
      result.number ??
        result.queue_number ??
        result.current_number ??
        result.next_number,
    );
    return Number.isInteger(number) && number >= 1 ? number : null;
  } catch {
    return null;
  }
}

async function incrementCurrentNumber(db, sector, sequenceType) {
  const { data: seq, error } = await db
    .from("queue_sequences")
    .select("current_number")
    .eq("sector_id", sector)
    .eq("call_type", sequenceType)
    .maybeSingle();

  if (error && !String(error.message || "").includes("column")) {
    throw error;
  }

  if (seq && Object.prototype.hasOwnProperty.call(seq, "current_number")) {
    const nextNum = nextValue(seq.current_number);
    const { error: updateError } = await db
      .from("queue_sequences")
      .update({
        current_number: nextNum,
        updated_at: new Date().toISOString(),
      })
      .eq("sector_id", sector)
      .eq("call_type", sequenceType);
    if (updateError) throw updateError;
    return nextNum;
  }

  const { error: insertError } = await db.from("queue_sequences").insert({
    sector_id: sector,
    call_type: sequenceType,
    current_number: 1,
  });
  if (insertError) throw insertError;
  return 1;
}

async function incrementLegacyColumns(db, sector, sequenceType) {
  const field =
    sequenceType === "preferencial" ? "priority_current" : "normal_current";
  const { data: rows, error } = await db
    .from("queue_sequences")
    .select("*")
    .eq("sector_id", sector)
    .limit(1);

  if (error) throw error;
  const seqData = rows?.[0];
  if (!seqData || !(field in seqData)) return null;

  const nextNum = nextValue(seqData[field]);
  const { error: updateError } = await db
    .from("queue_sequences")
    .update({
      [field]: nextNum,
      call_type: sequenceType,
      updated_at: new Date().toISOString(),
    })
    .eq("sector_id", sector);
  if (updateError) throw updateError;
  return nextNum;
}

export async function nextQueueNumberForSector(db, sector, sequenceType) {
  const fromRpc = await incrementViaRpc(db, sector, sequenceType);
  if (fromRpc) return fromRpc;

  try {
    return await incrementCurrentNumber(db, sector, sequenceType);
  } catch (error) {
    const legacy = await incrementLegacyColumns(db, sector, sequenceType);
    if (legacy) return legacy;
    throw error;
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

export async function insertQueueCall(
  db,
  { sector, nextNum, numberStr, sequenceType, callType, attendantId },
) {
  const callerId = isUuid(attendantId) ? attendantId : null;
  const base = {
    sector_id: sector,
    type: callType,
    number_int: nextNum,
    number_str: numberStr,
  };

  const primary = await db.from("queue_calls").insert({
    ...base,
    called_by: callerId,
  });

  if (!primary.error) return;

  const fallback = await db.from("queue_calls").insert({
    ...base,
    call_type: sequenceType,
    attendant_id: callerId,
  });

  if (fallback.error) throw fallback.error;
}

export async function resetSectorSequence(db, sector) {
  const now = new Date().toISOString();
  const currentNumberReset = await db
    .from("queue_sequences")
    .update({ current_number: 0, updated_at: now })
    .eq("sector_id", sector);

  if (!currentNumberReset.error) return;

  const legacyReset = await db
    .from("queue_sequences")
    .update({
      normal_current: 0,
      priority_current: 0,
      updated_at: now,
    })
    .eq("sector_id", sector);

  if (legacyReset.error) throw currentNumberReset.error;
}
