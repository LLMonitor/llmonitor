import sql from "@/utils/db"
import Router from "koa-router"

const radars = new Router({
  prefix: "/radars",
})

const DEFAULT_RADARS = [
  // {
  //   description: "Unhelpful answers",
  //   view: [
  //     "OR",
  //     {
  //       id: "type",
  //       params: {
  //         type: "chat",
  //       },
  //     },
  //     {
  //       id: "type",
  //       params: {
  //         type: "llm",
  //       },
  //     },
  //   ],
  //   checks: [
  //     "AND",
  //     {
  //       id: "feedbacks",
  //       params: {
  //         feedbacks: [{ thumbs: "up" }],
  //       },
  //     },
  //   ],
  // },
  {
    description: "Failed or slow LLM calls",
    view: [
      "AND",
      {
        id: "type",
        params: {
          type: "llm",
        },
      },
    ],
    checks: [
      "OR",
      {
        id: "status",
        params: {
          status: "error",
        },
      },
      {
        id: "duration",
        params: {
          operator: "gt",
          duration: 30000,
        },
      },
    ],
  },
  {
    description: "Answer contains PII (Personal Identifiable Information)",
    view: [
      "AND",
      {
        id: "type",
        params: {
          type: "llm",
        },
      },
    ],
    checks: [
      "OR",
      {
        id: "email",
        params: {
          field: "output",
          type: "contains",
        },
      },
      {
        id: "cc",
        params: {
          field: "output",
          type: "contains",
        },
      },
      {
        id: "phone",
        params: {
          field: "output",
          type: "contains",
        },
      },
    ],
  },
]

radars.get("/", async (ctx) => {
  const { projectId } = ctx.state

  const rows = await sql`
    SELECT r.*, 
      COUNT(rr.id) FILTER (WHERE rr.passed = true) AS passed,
      COUNT(rr.id) FILTER (WHERE rr.passed = false) AS failed
    FROM radar r
    LEFT JOIN radar_result rr ON rr.radar_id = r.id
    WHERE r.project_id = ${projectId}
    GROUP BY r.id
  `

  ctx.body = rows
})

radars.get("/:radarId", async (ctx) => {
  const { projectId } = ctx.state
  const { radarId } = ctx.params

  const [row] = await sql`
    SELECT r.*, 
      COUNT(rr.id) FILTER (WHERE rr.passed = true) AS passed,
      COUNT(rr.id) FILTER (WHERE rr.passed = false) AS failed
    FROM radar r
    LEFT JOIN radar_result rr ON rr.radar_id = r.id
    WHERE r.id = ${radarId} AND r.project_id = ${projectId}
    GROUP BY r.id
  `

  ctx.body = row
})

radars.get("/:radarId/chart", async (ctx) => {
  // get number of passing & failing runs for each day in the last 7 days
  // including days with no runs (passing and failing counts as 0)
  const { projectId } = ctx.state
  const { radarId } = ctx.params

  const rows = await sql`
    WITH date_series AS (
      SELECT generate_series(
        NOW() - INTERVAL '7 days',
        NOW(),
        '1 day'::interval
      )::date AS day
    )
    SELECT 
      ds.day,
      COALESCE(SUM(CASE WHEN rr.passed = true THEN 1 ELSE 0 END), 0) AS passed,
      COALESCE(SUM(CASE WHEN rr.passed = false THEN 1 ELSE 0 END), 0) AS failed
    FROM date_series ds
    LEFT JOIN (
      SELECT rr.*, r.created_at AS run_created_at FROM radar_result rr
      JOIN run r ON rr.run_id = r.id
      WHERE rr.radar_id = ${radarId} AND r.project_id = ${projectId}
    ) rr ON date_trunc('day', rr.run_created_at) = ds.day
    GROUP BY ds.day
    ORDER BY ds.day ASC
  `

  ctx.body = rows.map((row) => ({
    ...row,
    passed: Number(row.passed),
    failed: Number(row.failed),
  }))
})

radars.post("/", async (ctx) => {
  const { projectId, userId } = ctx.state
  const { description, view, checks, alerts } = ctx.request.body as {
    description: string
    view: any[]
    checks: any[]
    alerts: any[]
  }

  const [row] = await sql`
    INSERT INTO radar ${sql({
      description,
      view: sql.json(view),
      checks: sql.json(checks),
      // alerts: sql.json(alerts),
      projectId,
      ownerId: userId,
    })}
    RETURNING *
  `
  ctx.body = row
})

radars.patch("/:radarId", async (ctx) => {
  const { projectId } = ctx.state
  const { radarId } = ctx.params

  const { description, view, checks, alerts } = ctx.request.body as {
    description: string
    view: any[]
    checks: any[]
    alerts: any[]
  }

  const [row] = await sql`
    UPDATE radar
    SET ${sql({
      description,
      view: sql.json(view),
      checks: sql.json(checks),
      // alerts: sql.json(alerts),
    })}
      WHERE id = ${radarId} AND project_id = ${projectId}
      RETURNING *
      `
  ctx.body = row
})

radars.delete("/:radarId", async (ctx) => {
  const { projectId } = ctx.state
  const { radarId } = ctx.params

  const [row] = await sql`
    DELETE FROM radar
    WHERE id = ${radarId}
    AND project_id = ${projectId}
    RETURNING *
  `
  ctx.body = row
})

export default radars
