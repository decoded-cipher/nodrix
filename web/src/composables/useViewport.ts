// Reactive phone-width flag for dashboards: below 768px render the phone layout.
// Separate from the ui store's isMobile (1024px, sidebar) so the public/embedded
// viewer can use it without auth state.

import { onBeforeUnmount, ref, type Ref } from 'vue';

const PHONE_QUERY = '(max-width: 767px)';

export function useIsPhone(): Ref<boolean> {
  const mql = typeof window !== 'undefined' ? window.matchMedia(PHONE_QUERY) : null;
  const isPhone = ref<boolean>(mql?.matches ?? false);

  const onChange = (e: MediaQueryListEvent) => {
    isPhone.value = e.matches;
  };
  mql?.addEventListener('change', onChange);
  onBeforeUnmount(() => mql?.removeEventListener('change', onChange));

  return isPhone;
}
