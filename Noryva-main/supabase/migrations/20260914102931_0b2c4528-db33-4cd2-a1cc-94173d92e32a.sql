DROP POLICY "Inloggade kan lasa forfragningar" ON public.contact_requests;

CREATE POLICY "Endast admin kan lasa forfragningar"
  ON public.contact_requests
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));