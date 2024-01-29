import sql from "@/utils/db"
import { convertFiltersToSQL } from "@/utils/filters"
import { FILTERS, FilterLogic, LogicData, LogicElement } from "shared"

type RadarResults = {
  passed: boolean
  filterId?: string
  details?: any
}

const hasNonSQLFilter = (checks: FilterLogic): boolean =>
  checks.some((check) => {
    if (typeof check === "string") return false

    if (Array.isArray(check)) return hasNonSQLFilter(check)

    const { id } = check

    const filter = FILTERS.find((f) => f.id === id)

    if (filter?.evaluator) {
      return true
    }

    return false
  })

const checkRun = async (
  run: any,
  check: LogicElement,
): Promise<RadarResults> => {
  if (typeof check === "string") {
    // Handle AND or OR
    return { passed: check !== "OR" }
  }

  if (Array.isArray(check)) {
    const logicType = check[0]
    const subChecks = check.slice(1)
    if (logicType === "OR") {
      for (const subCheck of subChecks) {
        const result = await checkRun(run, subCheck)
        if (result.passed) {
          return { passed: true, details: [result] }
        }
      }
      return {
        passed: false,
        details: subChecks.map(() => ({ passed: false })),
      }
    } else {
      // Handle nested AND
      const results: RadarResults[] = await Promise.all(
        subChecks.map((subCheck) => checkRun(run, subCheck)),
      )
      return {
        passed: results.every((result) => result.passed),
        details: results,
      }
    }
  }

  const { id, params } = check
  const filter = FILTERS.find((f) => f.id === id)

  if (!filter || (!filter.sql && !filter.evaluator)) {
    return { passed: true }
  }

  if (filter.sql) {
    const snippet = filter.sql(sql, params)
    const [result] =
      await sql`select * from run where id = ${run.id} and (${snippet})`
    return { passed: !!result, filterId: id }
  }

  return { filterId: filter.id, ...(await filter.evaluator!(run, params)) }
}

const runChecksOnRun = async (radar: any, run: any) => {
  const checks: FilterLogic = radar.checks

  let passed = true
  const results: RadarResults[] = []

  const onlySQL = !hasNonSQLFilter(checks)

  if (onlySQL) {
    // More efficient to do it all in SQL if only SQL filters are used
    const filterSql = convertFiltersToSQL(checks)

    const [result] =
      await sql`select * from run where id = ${run.id} and (${filterSql})`

    passed = !!result
  } else {
    const logicType = checks[0]
    const subChecks = checks.slice(1)
    if (logicType === "OR") {
      for (const check of subChecks) {
        const res = await checkRun(run, check)
        results.push(res)
        if (res.passed) {
          passed = true
          break
        }
      }
    } else {
      // Handle nested AND
      for (const check of subChecks) {
        const res = await checkRun(run, check)
        results.push(res)
        passed = res.passed
        if (!res.passed) break
      }
    }
  }

  console.log(`Run ${run.id} passed: ${passed}`)

  await sql`
    insert into radar_result ${sql({
      radarId: radar.id,
      runId: run.id,
      results,
      passed,
    })}
    returning *
  `
}

const BATCH_SIZE = 1000

// get all runs that don't have radar results
// oldest first, limit 300 per batch
async function getRadarRuns(radar: any) {
  const filtersQuery = convertFiltersToSQL(radar.view)

  const excludedRunsSubquery = sql`select run_id from radar_result where radar_id = ${radar.id}`
  return await sql`
    select * from run
    where 
      project_id = ${radar.projectId}
      and ${filtersQuery}
      and id not in (${excludedRunsSubquery})
    order by created_at asc
    limit ${BATCH_SIZE}
  `
}

let jobRunning = false

export default async function radarJob() {
  if (jobRunning) {
    console.warn("JOB: radar scan already running. skipping")
    return
  }

  const radars = await sql`SELECT * FROM radar`

  // For each radar, get all checks
  for (const radar of radars) {
    const runs = await getRadarRuns(radar)
    console.log(`Analyzing ${runs.length} runs for radar ${radar.id}`)

    for (const run of runs) {
      try {
        await runChecksOnRun(radar, run)
      } catch (error) {
        console.error(error)
      }
    }
  }

  jobRunning = false
}

await radarJob()
