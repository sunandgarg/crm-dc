import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, AlertCircle } from 'lucide-react';

const KNOWN_ROUTES = new Set([
  'auth', 'dashboard', 'lead-push', 'crm', 'settings',
  'url-shortener', 'telecaller', 'universities', 'upload',
  'history', 'logs', 'marketing',
]);

/**
 * Public short-link resolver backed by the CRM DC API.
 */
export default function UrlRedirect() {
  const params = useParams<{ code?: string; header?: string; codeOrHeader?: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    (async () => {
      let header: string | null = null;
      let code: string | null = null;

      if (params.header && params.code) {
        header = params.header;
        code = params.code;
      } else if (params.code) {
        code = params.code;
      } else if (params.codeOrHeader) {
        const value = params.codeOrHeader;
        if (KNOWN_ROUTES.has(value.toLowerCase())) {
          navigate('/not-found', { replace: true });
          return;
        }
        code = value;
      }

      if (!code) { setError('Invalid URL'); return; }

      try {
        let query = supabase
          .from('url_mappings')
          .select('id, original_url, is_active, expires_at, user_tracking')
          .eq('short_code', code);

        if (header) {
          query = query.eq('header', header.toUpperCase());
        } else {
          query = query.is('header', null);
        }

        let { data: mapping } = await query.maybeSingle();

        // Broader fallback
        if (!mapping && !header) {
          const { data } = await supabase
            .from('url_mappings')
            .select('id, original_url, is_active, expires_at, user_tracking')
            .eq('short_code', code)
            .maybeSingle();
          mapping = data;
        }

        if (!mapping) {
          // Check if it could be a header
          if (params.codeOrHeader && !header) {
            const { data: headerMatches } = await supabase
              .from('url_mappings')
              .select('id')
              .eq('header', params.codeOrHeader.toUpperCase())
              .limit(1);
            if (!headerMatches?.length) {
              navigate('/*', { replace: true });
              return;
            }
          }
          setError('URL not found');
          return;
        }

        if (!mapping.is_active) { setError('This link has been deactivated'); return; }
        if (mapping.expires_at && new Date(mapping.expires_at) < new Date()) {
          setError('This link has expired');
          return;
        }

        if (mapping.user_tracking !== false) {
          void supabase.functions.invoke('url-redirect', { body: { code } });
        }
        window.location.replace(mapping.original_url);
      } catch (e) {
        console.error('[UrlRedirect] Error:', e);
        setError('Something went wrong');
      }
    })();
  }, [params.code, params.header, params.codeOrHeader, navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <AlertCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Oops!</h1>
          <p className="text-muted-foreground mb-6">{error}</p>
          <a
            href="/"
            className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Go to Homepage
          </a>
        </div>
      </div>
    );
  }

  return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
}
