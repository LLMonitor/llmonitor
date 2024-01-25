/*
 * TODO everything, this is just a mockup
 */

import { AreaChart, Area, CartesianGrid, ResponsiveContainer } from "recharts"

export default function TinyPercentChart({ height, width, data }) {
  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart width={500} height={400} data={data}>
        <CartesianGrid strokeDasharray="3 3" />

        <Area
          type="monotone"
          dataKey="failed"
          stackId="1"
          fill="crimson"
          stroke="transparent"
        />
        <Area
          type="monotone"
          dataKey="passed"
          stackId="1"
          fill="teal"
          stroke="transparent"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
