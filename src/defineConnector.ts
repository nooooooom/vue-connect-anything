import { computed, DefineComponent, defineComponent, getCurrentInstance, h, VNode } from 'vue'
import { forwardRef } from 'vue-forward-ref'
import {
  cloneVNode,
  isEventKey,
  isVue2,
  mergedClass,
  mergedStyle,
  mergeListeners,
  ShapeFlags,
  toListenerKey,
  useProps
} from 'vue-lib-toolkit'
import { SpecifyProps, SpecifyPropsValues } from './specifyProps'
import {
  ComponentCreationType,
  DefineConnector,
  MapStateProps,
  MapStatePropsFactory,
  MapStaticProps,
  MergeProps
} from './types'

function normalizeFunction<T extends (...args: any[]) => any>(
  func: unknown,
  candidate: Function = () => null
): T {
  return (typeof func === 'function' ? func : candidate) as T
}

function defaultMergeProps<StateProps, StaticProps, OwnProps, MergedProps>(
  stateProps: StateProps,
  staticProps: StaticProps,
  ownProps: OwnProps
): MergedProps {
  return { ...ownProps, ...stateProps, ...staticProps } as MergedProps
}

function isDefineComponent(component: ComponentCreationType): component is DefineComponent {
  return !!component && typeof component === 'object'
}

// implementation
function defineConnector<StateProps = {}, StaticProps = {}, OwnProps = {}, MergedProps = {}>(
  mapStateProps?:
    | MapStateProps<StateProps, OwnProps>
    | MapStatePropsFactory<StateProps, OwnProps>
    | null
    | undefined,
  mapStaticProps?: MapStaticProps<StaticProps, OwnProps> | null | undefined,
  mergeProps?: MergeProps<StateProps, StaticProps, OwnProps, MergedProps> | null | undefined
) {
  // normalize
  const normalizedMapStateProps = normalizeFunction<
    MapStateProps<StateProps, OwnProps> | MapStatePropsFactory<StateProps, OwnProps>
  >(mapStateProps)
  const normalizedMapStaticProps =
    normalizeFunction<MapStaticProps<StaticProps, OwnProps>>(mapStaticProps)
  const normalizedMergeProps = normalizeFunction(mergeProps, defaultMergeProps)

  return (component: ComponentCreationType) => {
    const wrappedComponentName = (isDefineComponent(component) && component.name) || 'Component'
    const connectComponentName = `Connect${wrappedComponentName}`

    const Connect = defineComponent({
      name: connectComponentName,

      inheritAttrs: false,

      setup(props, context) {
        const instance = getCurrentInstance()!

        const ownProps = useProps<OwnProps>()

        const initializedStateProps = normalizedMapStateProps(ownProps, instance)
        const stateProps =
          typeof initializedStateProps === 'function'
            ? // factory
              computed(() =>
                (initializedStateProps as MapStateProps<StateProps, OwnProps>)(ownProps, instance)
              )
            : computed(() => normalizedMapStateProps(ownProps, instance) as StateProps)
        const staticProps = normalizedMapStaticProps(ownProps, instance)
        const mergedProps = computed(() =>
          normalizedMergeProps(stateProps.value, staticProps, ownProps, instance)
        )

        // TODO: Changes to specify props also effect the component props
        const componentProps = computed(() => {
          const props = { ...mergedProps.value } as Record<string, any>

          for (const s of SpecifyPropsValues) {
            delete props[s]
          }

          return props
        })

        const slotsProps = computed(() => mergedProps.value[SpecifyProps.SCOPED_SLOTS])
        const classAndStyleProps = computed(() => {
          const { value: mergedPropsValue } = mergedProps
          return {
            class: mergedClass(
              componentProps.value.class,
              mergedPropsValue[SpecifyProps.CLASS],
              mergedPropsValue[SpecifyProps.STATIC_CLASS]
            ),
            style: mergedStyle(
              componentProps.value.style,
              mergedPropsValue[SpecifyProps.STYLE],
              mergedPropsValue[SpecifyProps.STATIC_STYLE]
            )
          }
        })

        if (isVue2) {
          // { onEvent, ... }
          const listenerProps = computed(() => {
            const props = componentProps.value
            const listenerProps = {} as Record<string, any>

            for (const prop in props) {
              if (isEventKey(prop)) {
                listenerProps[toListenerKey(prop)] = props[prop]
              }
            }

            return listenerProps
          })

          return () => {
            const props = componentProps.value
            const finalProps = {
              attrs: { ...props },
              on: mergeListeners((context as any).listeners, listenerProps.value),
              scopedSlots: {
                ...(instance.proxy as any).$scopedSlots,
                ...slotsProps.value
              },
              slots: {
                ...(instance.proxy as any).$slots,
                ...mergedProps.value[SpecifyProps.SLOTS]
              },
              ...classAndStyleProps.value
            }

            let vnode: VNode | undefined
            if (typeof component === 'object') {
              // @ts-ignore: Vue2's `h` doesn't process vnode
              const EmptyVNode = h()
              if (component instanceof EmptyVNode.constructor) {
                vnode = cloneVNode(component as VNode, finalProps)
              }
            }

            if (!vnode) {
              vnode = h(component as any, finalProps)
            }

            return forwardRef(vnode)
          }
        }

        return () => {
          const props = { ...componentProps.value, ...classAndStyleProps.value }
          const children = instance.vnode.children
          const slots = children
            ? instance.vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN
              ? (children as any)
              : {
                  default: () => children
                }
            : null

          const vnode = h(component as any, props, {
            ...slots,
            ...slotsProps.value
          })

          return forwardRef(vnode)
        }
      }
    })

    return Connect as DefineComponent<OwnProps>
  }
}

export default defineConnector as DefineConnector
