-- 只读逐请求风险清单。仅连接明确指定的隔离数据库；start_at/end_at 必须显式提供。
-- psql "$TEST_DSN" -v start_at="2026-10-24T00:00:00+08:00" -v end_at="2026-10-25T00:00:00+08:00" -f tools/stage7_cost_reconciliation.sql
-- 该查询不修改任何账单，不触发历史补扣。unknown 金额保持 NULL。
BEGIN READ ONLY;
WITH candidates AS MATERIALIZED (
  SELECT id, request_id, client_request_id, api_key_id, user_id, group_id,
         platform, COALESCE(NULLIF(requested_model,''),model) AS model,
         status_code, created_at, upstream_errors
  FROM ops_error_logs
  WHERE created_at >= :'start_at'::timestamptz AND created_at < :'end_at'::timestamptz
    AND NOT is_count_tokens
), logical AS (
  SELECT DISTINCT ON (COALESCE(NULLIF(request_id,''),'error:'||id::text)) *
  FROM candidates ORDER BY COALESCE(NULLIF(request_id,''),'error:'||id::text),created_at DESC,id DESC
), attempts AS (
  SELECT DISTINCT COALESCE(NULLIF(request_id,''),'error:'||id::text) AS request_key,
         COALESCE(NULLIF(event #>> '{procurement,attempt_id}',''),event::text) AS attempt_id,
         event
  FROM candidates CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(upstream_errors)='array' THEN upstream_errors ELSE '[]'::jsonb END
  ) events(event)
), risks AS (
  SELECT request_key,COUNT(*) AS failed_attempts,
         COUNT(*) FILTER (WHERE COALESCE(event #>> '{procurement,cost_status}','unknown') <> 'confirmed') AS unknown_cost_attempts,
         jsonb_agg(jsonb_build_object(
           'attempt_id',attempt_id,'account_id',event->'account_id',
           'supplier_request_id',event->'upstream_request_id',
           'model',event #> '{procurement,model}',
           'stage',event #> '{procurement,stage}',
           'failure_kind',event->'kind',
           'cost_status',COALESCE(event #>> '{procurement,cost_status}','unknown'),
           'supplier_cost_usd',event #> '{procurement,supplier_cost_usd}',
           'usage',event #> '{procurement,usage}'
         ) ORDER BY attempt_id) AS failed_procurement
  FROM attempts GROUP BY request_key
)
SELECT l.request_id,l.client_request_id,l.api_key_id,l.user_id,l.platform,l.group_id,l.model,
       l.status_code AS final_logical_status,
       COALESCE(r.failed_attempts,0) AS failed_attempts,
       COALESCE(r.unknown_cost_attempts,0) AS unknown_cost_attempts,
       r.failed_procurement,
       sales.account_id AS settled_account_id,
       sales.settled_usage_rows,
       sales.local_charged_usd,
       sales.pricing_based_upstream_estimate_usd,
       -- 原统计基数可能来自官方目录或本地售价，未经供应商验证，不得称实际采购。
       'unverified_catalog_estimate'::text AS catalog_cost_status,
       NULL::numeric AS verified_channel_estimate_usd,
       NULL::numeric AS confirmed_supplier_cost_usd,
       -- 多次潜在采购不是多次已确认收费；该提示只供管理员调查。
       CASE WHEN COALESCE(r.unknown_cost_attempts,0)>0 AND sales.settled_usage_rows>0 THEN 'multiple_potential_procurement'
            WHEN COALESCE(r.unknown_cost_attempts,0)>0 THEN 'unreconciled_risk'
            ELSE 'supplier_statement_required' END AS review_reason
FROM logical l LEFT JOIN risks r ON r.request_key=COALESCE(NULLIF(l.request_id,''),'error:'||l.id::text)
LEFT JOIN LATERAL (
  SELECT MIN(ul.account_id) AS account_id,COUNT(*) AS settled_usage_rows,
         COALESCE(SUM(ul.actual_cost),0) AS local_charged_usd,
         -- 统计定价字段保存未乘倍率的基数，与正式账号成本统计保持相同口径。
         SUM(COALESCE(ul.account_stats_cost,ul.total_cost)*COALESCE(ul.account_rate_multiplier,1)) AS pricing_based_upstream_estimate_usd
  FROM usage_logs ul
  WHERE ul.api_key_id=l.api_key_id AND ul.actual_cost>0
    AND ((NULLIF(l.client_request_id,'') IS NOT NULL AND ul.request_id='client:'||l.client_request_id)
      OR (NULLIF(l.request_id,'') IS NOT NULL AND ul.request_id='local:'||l.request_id))
) sales ON TRUE
ORDER BY l.created_at,l.id;
ROLLBACK;
