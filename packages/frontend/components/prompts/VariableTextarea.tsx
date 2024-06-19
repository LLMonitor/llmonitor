import { Textarea, ActionIcon, TextareaProps, Modal, Box } from "@mantine/core"
import { IconArrowsMaximize } from "@tabler/icons-react"
import { useDisclosure } from "@mantine/hooks"
import { ChangeEvent, useState } from "react"

type VariableTextareaProps = TextareaProps & {
  name: string
  defaultValue: string
}

export default function VariableTextarea({
  name,
  defaultValue,
  onChange,
  ...props
}: VariableTextareaProps) {
  // Local copy of user updated value for popup
  const [value, setValue] = useState<string>(defaultValue)
  const [opened, { open, close }] = useDisclosure(false)

  const updateValue = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.currentTarget.value)
    onChange && onChange(e)
  }

  return (
    <>
      <Modal
        opened={opened}
        onClose={close}
        title={name}
        overlayProps={{
          backgroundOpacity: 0.55,
          blur: 3,
        }}
        size="xl"
      >
        {/* Modal content */}
        <Textarea
          size="lg"
          required={true}
          radius="sm"
          rows={10}
          autosize
          value={value}
          onChange={updateValue}
        />
      </Modal>

      <Box style={{ position: "relative" }}>
        <Textarea {...props} onChange={updateValue} value={value} />

        <ActionIcon
          size="sm"
          onClick={open}
          aria-label="expand textarea"
          style={{
            position: "absolute",
            right: "5%",
            bottom: "5%",
            marginBottom: "0.3rem",
          }}
        >
          <IconArrowsMaximize />
        </ActionIcon>
      </Box>
    </>
  )
}
