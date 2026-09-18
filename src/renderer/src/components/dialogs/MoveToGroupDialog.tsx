import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogActions, DialogButton, DialogField } from '../Dialog'
import { DialogSelect, type DialogSelectOption } from '../DialogSelect'
import { useAgentStore } from '../../stores/useAgentStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useUIStore } from '../../stores/useUIStore'
import { getFeatures } from '../../features'

const NO_GROUP_VALUE = '__ungrouped__'

export function MoveToGroupDialog() {
  const { activeDialog, dialogTargetId, closeDialog } = useUIStore()
  const { projects, groups: projectGroups, moveProjectToGroup } = useProjectStore()
  const { agents, groups: agentGroups, moveAgentToGroup } = useAgentStore()
  const [submitting, setSubmitting] = useState(false)

  const mode = activeDialog === 'move-project-group'
    ? 'project'
    : activeDialog === 'move-agent-group' && getFeatures().standaloneAgents
      ? 'agent'
      : null

  const target = useMemo(() => {
    if (!mode || !dialogTargetId) return null
    return mode === 'project'
      ? projects.find((project) => project.id === dialogTargetId) ?? null
      : agents.find((agent) => agent.id === dialogTargetId) ?? null
  }, [agents, dialogTargetId, mode, projects])

  const groups = mode === 'project' ? projectGroups : agentGroups
  const open = mode !== null && target !== null
  const currentValue = target?.group_id ?? NO_GROUP_VALUE
  const [selectedGroupId, setSelectedGroupId] = useState(currentValue)

  useEffect(() => {
    setSelectedGroupId(currentValue)
  }, [currentValue])

  const options: DialogSelectOption[] = useMemo(() => ([
    { value: NO_GROUP_VALUE, label: 'No Group' },
    ...groups.map((group) => ({ value: group.id, label: group.name }))
  ]), [groups])

  const title = mode === 'agent' ? 'Move Agent to Group' : 'Move Project to Group'
  const label = 'Group'
  const submitLabel = mode === 'agent' ? 'Move Agent' : 'Move Project'

  const handleClose = () => {
    if (submitting) return
    closeDialog()
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!target || !mode) return

    setSubmitting(true)
    try {
      const nextGroupId = selectedGroupId === NO_GROUP_VALUE ? null : selectedGroupId
      if (mode === 'project') {
        await moveProjectToGroup(target.id, nextGroupId)
      } else {
        await moveAgentToGroup(target.id, nextGroupId)
      }
      closeDialog()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit}>
        <DialogField label={label}>
          <DialogSelect
            value={selectedGroupId}
            onChange={setSelectedGroupId}
            options={options}
          />
        </DialogField>
        <div className="dialog-hint">
          {mode === 'project'
            ? 'Choose which project group should contain this project.'
            : 'Choose which group should contain this agent.'}
        </div>
        <DialogActions>
          <DialogButton onClick={handleClose} disabled={submitting}>Cancel</DialogButton>
          <DialogButton variant="primary" type="submit" loading={submitting}>{submitLabel}</DialogButton>
        </DialogActions>
      </form>
    </Dialog>
  )
}
