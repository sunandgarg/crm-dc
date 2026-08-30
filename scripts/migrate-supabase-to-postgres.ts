const sourceUrl = String(process.env.SOURCE_SUPABASE_URL || '').replace(/\/+$/, '');
const sourceKey = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY || '';
const destinationUrl = String(process.env.DESTINATION_API_URL || 'http://localhost:4000').replace(/\/api\/?$/, '').replace(/\/+$/, '');
const destinationToken = process.env.DESTINATION_API_TOKEN || '';

const orderedResources = `profiles universities pipeline_stages programs state_cities course_specializations custom_columns custom_column_values upload_batches leads api_logs crm_contacts crm_activities crm_tasks feature_toggles user_roles user_permissions automation_rules marketing_campaigns app_settings automation_logs campaign_kpis campaign_recipients custom_domains dlt_entities email_api_settings email_campaigns email_events email_recipients email_templates form_submissions funnel_campaign_contacts funnel_campaigns landing_pages lead_assignment_history lead_assignment_rules lead_capture_forms lead_events lead_push_cumulative_stats lead_push_daily_stats lead_scoring_rules lead_segment_members lead_segments marketing_custom_integrations marketing_integrations marketing_leads marketing_sequence_steps marketing_sequences marketing_templates marketing_workflows multi_push_presets smtp_campaigns smtp_domains smtp_email_logs smtp_link_clicks smtp_links smtp_suppression_list smtp_templates smtp_tracking_events team_members university_api_keys url_api_keys url_bulk_imports url_clicks url_mappings`.split(' ');

if (!sourceUrl || !sourceKey || !destinationToken) {
  throw new Error('Set SOURCE_SUPABASE_URL, SOURCE_SUPABASE_SERVICE_ROLE_KEY, DESTINATION_API_URL, and DESTINATION_API_TOKEN');
}

const requested = process.env.MIGRATION_RESOURCES?.split(',').map(value => value.trim()).filter(Boolean);
const resources = requested?.length ? orderedResources.filter(resource => requested.includes(resource)) : orderedResources;
const ledger: Record<string, { read: number; written: number; errors: string[] }> = {};

async function readPage(resource: string, offset: number) {
  const response = await fetch(`${sourceUrl}/rest/v1/${resource}?select=*&offset=${offset}&limit=1000`, { headers: { apikey: sourceKey, authorization: `Bearer ${sourceKey}` } });
  if (!response.ok) throw new Error(`source ${response.status}: ${await response.text()}`);
  return response.json() as Promise<Record<string, unknown>[]>;
}

async function writeChunk(resource: string, rows: Record<string, unknown>[]) {
  const response = await fetch(`${destinationUrl}/api/data/${resource}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${destinationToken}` },
    body: JSON.stringify({ action: 'upsert', data: rows, onConflict: 'id' }),
  });
  if (!response.ok) throw new Error(`destination ${response.status}: ${await response.text()}`);
}

for (const resource of resources) {
  ledger[resource] = { read: 0, written: 0, errors: [] };
  try {
    for (let offset = 0; ; offset += 1000) {
      const rows = await readPage(resource, offset);
      ledger[resource].read += rows.length;
      for (let index = 0; index < rows.length; index += 200) {
        const chunk = rows.slice(index, index + 200);
        try { await writeChunk(resource, chunk); ledger[resource].written += chunk.length; }
        catch (error) { ledger[resource].errors.push(error instanceof Error ? error.message : String(error)); }
      }
      if (rows.length < 1000) break;
    }
  } catch (error) { ledger[resource].errors.push(error instanceof Error ? error.message : String(error)); }
  console.log(`${resource}: ${ledger[resource].written}/${ledger[resource].read}${ledger[resource].errors.length ? ` (${ledger[resource].errors.length} errors)` : ''}`);
}

console.log(JSON.stringify({ completed_at: new Date().toISOString(), ledger }, null, 2));
if (Object.values(ledger).some(entry => entry.errors.length || entry.read !== entry.written)) process.exitCode = 1;
