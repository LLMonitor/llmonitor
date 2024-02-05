import Router from "koa-router"
import sql from "@/src/utils/db"
import { z } from "zod"
import Context from "@/src/utils/koa"
import { compileChatMessages, runAImodel } from "@/src/utils/playground"
import { calcRunCost } from "@/src/utils/calcCost"
import { runChecksOnRun } from "@/src/checks/runChecks"
import { FilterLogic } from "shared"
import { getReadableDateTime } from "@/src/utils/date"

const evaluations = new Router({ prefix: "/evaluations" })

evaluations.post("/", async (ctx: Context) => {
  // TODO: zod

  const { name, models, checks, prompts } = ctx.request.body as any
  const { userId, projectId } = ctx.state
  console.log(ctx.state)

  await sql.begin(async (sql) => {
    const evaluationToInsert = {
      name: name ? name : `Evaluation of ${getReadableDateTime()}`,
      ownerId: userId,
      projectId,
      models,
      checks,
    }

    const [insertedEvaluation] =
      await sql`insert into evaluation ${sql(evaluationToInsert)} returning *`

    console.log(prompts)
    for (const prompt of prompts) {
      const promptToInsert = {
        evaluationId: insertedEvaluation.id,
        content: prompt.content,
        extra: prompt.extra,
      }

      const [insertedPrompt] =
        await sql`insert into prompt ${sql(promptToInsert)} returning *`

      if (prompt.variations) {
        for (const variation of prompt.variations) {
          const variationToInsert = {
            promptId: insertedPrompt.id,
            variables: variation.variables,
            context: variation.context,
            idealOutput: variation.idealOutput,
          }

          await sql`insert into prompt_variation ${sql(variationToInsert)}`

          for (const model of insertedEvaluation.models) {
            console.log(model)
            await runEval(
              model,
              prompt.content,
              prompt.extra,
              variation,
              checks,
            )
          }
        }
      }
    }
  })

  ctx.status = 201
  ctx.body = {}
})

evaluations.get("/:id", async (ctx: Context) => {
  const evaluationId = z.string().uuid().parse(ctx.params.id)

  const rows = await sql`
    select
      e.*,
      p.id as prompt_id,
      p.content as prompt_content,
      p.extra as prompt_extra,
      pv.id as variation_id,
      pv.variables,
      pv.context,
      pv.ideal_output
    from
      evaluation e
      left join prompt p on e.id = p.evaluation_id
      left join prompt_variation pv on pv.prompt_id = p.id
    where 
      e.id = ${evaluationId}
    `

  if (!rows) {
    ctx.throw(404, "Evaluation not found")
    return
  }

  const { id, createdAt, name, ownerId, projectId, models, checks } = rows[0]

  const evaluation = {
    id,
    createdAt,
    name,
    ownerId,
    projectId,
    models,
    checks,
    prompts: rows.map(({ promptId, promptContent, promptExtra }) => ({
      id: promptId,
      content: promptContent,
      extra: promptExtra,
      variations: rows
        .filter((row) => row.promptId === promptId)
        .map(({ variationId, variables, context, idealOutput }) => ({
          id: variationId,
          variables,
          context,
          idealOutput,
        })),
    })),
  }

  ctx.body = evaluation
})

evaluations.get("/", async (ctx: Context) => {
  const { projectId } = ctx.state

  const evaluations = await sql`
    select
      e.id,
      e.created_at,
      e.name,
      a.name as owner_name,
      e.project_id
    from
      evaluation e
      left join account a on a.id = e.owner_id
    where
      e.project_id = ${projectId} 
    order by 
      created_at desc
  `

  ctx.body = evaluations
})

const testEval = {
  models: ["gpt-3.5-turbo"], //, "gpt-4-turbo-preview"],
  checks: [
    "OR",
    {
      id: "tone",
      params: {
        persona: "pirate",
      },
    },
  ],
  prompts: [
    {
      content: [{ role: "user", content: "{{question}}" }],
      extra: { temperature: 1 },
      variations: [
        {
          variables: {
            question: "Tell a joke like a pirate.",
          },
          // gold: "My name is SuperChatbot.",
          // context: "You are a chatbot called SuperChatbot.",
        },
        {
          variables: {
            question: "Tell a joke like a drunken chatbot.",
          },
          // gold: "My name is SuperChatbot.",
          // context: "You are a chatbot called SuperChatbot.",
        },
      ],
    },
  ],
}

async function runEval(
  model: string,
  prompt: any,
  extra: any,
  variation: any,
  checks: FilterLogic,
) {
  try {
    console.log(`=============================`)
    console.log(
      `Running eval for ${model} with variation ${JSON.stringify(variation.variables)}`,
    )
    const { variables, idealOutput, context } = variation

    // run AI query
    const createdAt = new Date()
    const input = compileChatMessages(prompt, variables)

    const res = await runAImodel(input, extra, undefined, model)
    const endedAt = new Date()

    // Create virtual run to be able to run checks
    const output = res.choices[0].message
    const promptTokens = res.usage.prompt_tokens
    const completionTokens = res.usage.completion_tokens
    const duration = endedAt.getTime() - createdAt.getTime()

    const virtualRun = {
      type: "llm",
      input,
      output,
      status: "success",
      params: extra,
      name: model,
      duration,
      promptTokens,
      completionTokens,
      createdAt,
      endedAt,
      // Eval-only fields:
      idealOutput,
      context,
      // So the SQL queries don't fail:
      id: "00000000-0000-4000-8000-000000000000",
      projectId: "00000000-0000-4000-8000-000000000000",
      isPublic: false,
    }

    virtualRun.cost = calcRunCost(virtualRun)

    console.log(` virtualRun: `, JSON.stringify(virtualRun, null, 2))

    // run checks
    const { passed, results } = await runChecksOnRun(virtualRun, checks)

    console.log({ passed, results })

    // insert into eval_result
    // await sql`
    //   insert into eval_result ${sql({
    //     model,
    //     prompt,
    //     extra,
    //     variables,
    //     gold,
    //     context,
    //     output
    //   })}
  } catch (error) {
    console.error(error)
  }
}

evaluations.post("/run", async (ctx) => {
  const { prompts, models, checks } = testEval

  // for each variation of each prompt and each model, run the eval
  for (const model of models) {
    for (const prompt of prompts) {
      for (const variation of prompt.variations) {
        await runEval(model, prompt.content, prompt.extra, variation, checks)
      }
    }
  }

  ctx.body = {}
})

export default evaluations
