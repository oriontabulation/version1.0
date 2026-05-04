import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://oriontabulation.com,https://www.oriontabulation.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function corsHeaders(origin?: string | null) {
  const originToUse = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? '';
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
  if (originToUse) h['Access-Control-Allow-Origin'] = originToUse;
  return h;
}

async function findAuthUserByEmail(adminSb: any, email: string) {
  const wanted = email.toLowerCase();

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await adminSb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;

    const user = data?.users?.find((u: any) => String(u.email || '').toLowerCase() === wanted);
    if (user) return user;
    if (!data?.users || data.users.length < 1000) break;
  }

  return null;
}

serve(async (req: Request) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);
  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Missing Authorization' }, 401);

    const callerSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user: caller } } = await callerSb.auth.getUser();
    if (!caller) return json({ error: 'Unauthorized' }, 401);

    const { tournamentId, email } = await req.json();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!tournamentId || !normalizedEmail) return json({ error: 'tournamentId and email required' }, 400);

    const { data: canManage, error: canManageErr } = await callerSb.rpc('can_manage_tournament', {
      p_tournament_id: tournamentId,
    });
    if (canManageErr || !canManage) return json({ error: 'Forbidden' }, 403);

    const adminSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const targetUser = await findAuthUserByEmail(adminSb, normalizedEmail);
    if (!targetUser?.id) {
      return json({ error: `No registered account found for "${email}". The user must sign up first.` }, 404);
    }

    const displayName = targetUser.user_metadata?.full_name
      || targetUser.user_metadata?.name
      || normalizedEmail.split('@')[0]
      || 'User';
    const username = normalizedEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');

    const { data: existingProfile } = await adminSb
      .from('user_profiles')
      .select('id, email')
      .eq('id', targetUser.id)
      .maybeSingle();

    if (existingProfile) {
      if (!existingProfile.email) {
        await adminSb.from('user_profiles')
          .update({ email: normalizedEmail })
          .eq('id', targetUser.id);
      }
    } else {
      await adminSb.from('user_profiles').insert({
        id: targetUser.id,
        username,
        name: displayName,
        email: normalizedEmail,
        status: 'active',
      });
    }

    const { data: entry, error: insertErr } = await adminSb
      .from('tournament_admins')
      .upsert({
        tournament_id: tournamentId,
        user_id: targetUser.id,
        added_by: caller.id,
      }, { onConflict: 'tournament_id,user_id' })
      .select('id, user_id, added_by, created_at')
      .single();

    if (insertErr) return json({ error: insertErr.message }, 500);
    return json({ ok: true, admin: entry });
  } catch (err) {
    console.error('[add-tournament-admin]', err);
    return json({ error: 'Internal error' }, 500);
  }
});
