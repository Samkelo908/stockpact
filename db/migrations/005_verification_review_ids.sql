UPDATE companies AS company
SET data = jsonb_set(data, '{verificationReviewIds}', jsonb_build_object(
  'business', coalesce((SELECT attempt_id FROM persona_inquiries WHERE company_id = company.id AND scope = 'business' AND NOT sandbox), gen_random_uuid()::text),
  'representative', coalesce((SELECT attempt_id FROM persona_inquiries WHERE company_id = company.id AND scope = 'representative' AND NOT sandbox), gen_random_uuid()::text),
  'delivery', coalesce((SELECT attempt_id FROM persona_inquiries WHERE company_id = company.id AND scope = 'delivery' AND NOT sandbox), gen_random_uuid()::text)
))
WHERE NOT demo AND NOT (data ? 'verificationReviewIds');
