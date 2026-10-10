import { useCallback, useMemo, useState } from 'react';

import {
  initialListingDraft,
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_DESCRIPTION_MIN_LENGTH,
  LISTING_TITLE_MAX_LENGTH,
  LISTING_TITLE_MIN_LENGTH,
  listingDescriptionLength,
  listingTitleLength,
  type ListingDraft,
  type ListingDraftErrors,
  type ListingDraftPhoto,
  type SellStep,
} from '@/features/sell/types/listingDraft';
import { isValidCity, isValidPostalCode, isValidState } from '@/features/location/locationValidation';
import { validateFlatShippingPrice } from '@/features/checkout/shippingPolicy';
import { PUBLIC_SHIPPING_ENABLED } from '@/config/launchFeatures';

const launchDraft = () => PUBLIC_SHIPPING_ENABLED
  ? initialListingDraft
  : { ...initialListingDraft, pickup: true, shipping: false, shippingPrice: '' };

export function useListingDraft() {
  const [draft, setDraft] = useState<ListingDraft>(launchDraft);
  const [step, setStep] = useState<SellStep>(1);
  const [errors, setErrors] = useState<ListingDraftErrors>({});

  const updateField = useCallback(<K extends keyof ListingDraft>(field: K, value: ListingDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }, []);

  const addPhotos = useCallback((photos: ListingDraftPhoto[]) => {
    setDraft((current) => ({
      ...current,
      photos: [...new Map(
        [...current.photos, ...photos].map((photo) => [photo.uri, photo]),
      ).values()].slice(0, 12),
    }));
    setErrors((current) => ({ ...current, photos: undefined }));
  }, []);

  const removePhoto = useCallback((id: string) => {
    setDraft((current) => ({
      ...current,
      photos: current.photos.filter((photo) => photo.id !== id),
    }));
  }, []);

  const movePhoto = useCallback((index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.photos.length) return current;
      const photos = [...current.photos];
      [photos[index], photos[destination]] = [photos[destination], photos[index]];
      return { ...current, photos };
    });
  }, []);

  const validateStep = useCallback((targetStep: SellStep = step) => {
    const nextErrors: ListingDraftErrors = {};

    if (targetStep === 1 && draft.photos.length === 0) {
      nextErrors.photos = 'Add at least one photo to continue.';
    }

    if (targetStep === 2) {
      const titleLength = listingTitleLength(draft.title);
      if (titleLength < LISTING_TITLE_MIN_LENGTH || titleLength > LISTING_TITLE_MAX_LENGTH) {
        nextErrors.title = `Title must be ${LISTING_TITLE_MIN_LENGTH}–${LISTING_TITLE_MAX_LENGTH} characters.`;
      }
      if (!draft.category) nextErrors.category = 'Choose a category.';
      if (!draft.brand.trim()) nextErrors.brand = 'Brand is required.';
      if (!draft.condition) nextErrors.condition = 'Choose the item condition.';
      const descriptionLength = listingDescriptionLength(draft.description);
      if (
        descriptionLength < LISTING_DESCRIPTION_MIN_LENGTH
        || descriptionLength > LISTING_DESCRIPTION_MAX_LENGTH
      ) {
        nextErrors.description = `Description must be ${LISTING_DESCRIPTION_MIN_LENGTH}–${LISTING_DESCRIPTION_MAX_LENGTH.toLocaleString()} characters.`;
      }
    }

    if (targetStep === 3) {
      const price = Number(draft.price);
      if (!draft.price.trim() || !Number.isFinite(price) || price <= 0) {
        nextErrors.price = 'Enter a valid price greater than $0.';
      }
      if (!draft.pickup && !draft.shipping) {
        nextErrors.delivery = 'Select local pickup, shipping, or both.';
      }
      if (draft.shipping) {
        const shippingPriceError = validateFlatShippingPrice(draft.shippingPrice);
        if (shippingPriceError) nextErrors.shippingPrice = shippingPriceError;
      }
      // Location is required only when publishing; complete drafts may be
      // saved without it and resumed later.
      if (draft.city || draft.state || draft.postalCode) {
        if (!isValidCity(draft.city)) nextErrors.city = 'Enter a valid city name.';
        if (!isValidState(draft.state)) nextErrors.state = 'Select a valid US state.';
        if (!isValidPostalCode(draft.postalCode)) nextErrors.postalCode = 'Use a 5-digit ZIP code or ZIP+4.';
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [draft, step]);

  const nextStep = useCallback(() => {
    if (!validateStep(step) || step === 4) return false;
    setStep((current) => Math.min(4, current + 1) as SellStep);
    return true;
  }, [step, validateStep]);

  const previousStep = useCallback(() => {
    setErrors({});
    setStep((current) => Math.max(1, current - 1) as SellStep);
  }, []);

  const goToStep = useCallback((next: SellStep) => {
    setErrors({});
    setStep(next);
  }, []);

  const resetDraft = useCallback(() => {
    setDraft(launchDraft());
    setErrors({});
    setStep(1);
  }, []);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(launchDraft()),
    [draft],
  );

  return {
    addPhotos,
    draft,
    errors,
    goToStep,
    isDirty,
    movePhoto,
    nextStep,
    previousStep,
    removePhoto,
    resetDraft,
    step,
    updateField,
    validateStep,
  };
}
